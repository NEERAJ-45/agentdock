import { randomUUID } from 'node:crypto';
import { db, Row } from './db.js'; import { bus, logEvent } from './bus.js';
import { docker, execStream, execCapture } from './docker.js'; import { config } from './config.js';
import { createInstance } from './instances.js'; import { nextFreeProfile } from './profiles.js';

const QUOTA = /rate.?limit|quota|usage limit|too many requests|insufficient_quota|\b429\b|credit balance|limit (reached|exceeded)/i;
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const cancelled = new Set<string>();
const locks = new Map<string, Promise<void>>();

// One writer per workspace: switching/continuing only happens after the previous process has exited.
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>(r => (release = r));
  const chain = prev.then(() => mine); locks.set(key, chain);
  await prev;
  try { return await fn(); } finally { release(); if (locks.get(key) === chain) locks.delete(key); }
}
function setStatus(id: string, status: string, error?: string | null, exit?: number) {
  db.prepare('update tasks set status=?, error=coalesce(?,error), exit_code=coalesce(?,exit_code), updated_at=? where id=?').run(status, error ?? null, exit ?? null, Date.now(), id);
  bus.emit('event', { type: 'task_status', taskId: id, status, error });
}
const addEvent = (id: string, kind: string, data: string) => db.prepare('insert into task_events(task_id,kind,data,ts) values(?,?,?,?)').run(id, kind, data, Date.now());

async function pickInstance(workspaceId: string, preferred?: string | null): Promise<Row | null> {
  const rows = (db.prepare('select * from instances where workspace_id=?').all(workspaceId) as Row[])
    .filter(r => !r.exhausted_until || r.exhausted_until < Date.now())
    .sort((a, b) => (a.id === preferred ? -1 : b.id === preferred ? 1 : 0));
  for (const r of rows) {
    try { if ((await docker.getContainer(r.container_id).inspect()).State.Running) return r; } catch {}
  }
  return null;
}
async function checkpoint(taskId: string, inst: Row, tail: string) {
  const script = `cd /workspace && git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo NOGIT; exit 0; }; echo "REF:$(git stash create)"; git status --porcelain; git diff --stat; echo '--- DIFF ---'; git diff HEAD | head -c 6000`;
  const { out } = await execCapture(inst.container_id, ['sh', '-c', script]).catch(() => ({ out: 'checkpoint failed' }));
  const ref = /^REF:(.*)$/m.exec(out)?.[1] || null;
  const id = randomUUID();
  db.prepare('insert into checkpoints values(?,?,?,?,?,?,?)').run(id, taskId, inst.id, ref, out.slice(0, 8000), tail.slice(-4000), Date.now());
  return { id, ref, summary: out, tail };
}
// Spin up a brand-new container (own credential profile, same workspace) when no eligible instance is left.
async function spawnForQuota(workspaceId: string): Promise<Row | null> {
  const count = (db.prepare('select count(*) c from instances').get() as Row).c;
  if (count >= config.maxInstances) { logEvent('warn', 'instance.spawn_skipped', `MAX_INSTANCES (${config.maxInstances}) reached`); return null; }
  const profile = nextFreeProfile();
  if (!profile) { logEvent('warn', 'instance.spawn_skipped', 'no free credential profile in PROFILES_DIR'); return null; }
  try { const i = await createInstance(`auto-${profile}`, workspaceId, profile); logEvent('info', 'instance.spawned', `${i.name} from profile ${profile}`); return i; }
  catch (e) { logEvent('error', 'instance.spawn_failed', String(e)); return null; }
}
const resumePrompt = (orig: string, cp: { summary: string; tail: string }) =>
  `You are resuming a task interrupted by a provider usage limit. Work already done is on disk in the workspace.\n\nORIGINAL INSTRUCTION:\n${orig}\n\nWORKSPACE STATE AT INTERRUPTION (git):\n${cp.summary.slice(0, 7000)}\n\nLAST OUTPUT BEFORE INTERRUPTION:\n${cp.tail.slice(-2000)}\n\nInspect the workspace, do NOT redo completed work, and finish the remaining parts.`;

export function submitTask(workspaceId: string, prompt: string, instanceId?: string, parentId?: string) {
  const id = randomUUID(), now = Date.now();
  db.prepare('insert into tasks(id,workspace_id,instance_id,prompt,status,attempts,parent_id,created_at,updated_at) values(?,?,?,?,?,0,?,?,?)')
    .run(id, workspaceId, instanceId ?? null, prompt, 'queued', parentId ?? null, now, now);
  logEvent('info', 'task.submitted', id);
  run(id).catch(e => { setStatus(id, 'failed', String(e)); logEvent('error', 'task.crash', String(e)); });
  return db.prepare('select * from tasks where id=?').get(id);
}
async function run(taskId: string) {
  const t = db.prepare('select * from tasks where id=?').get(taskId) as Row;
  await withLock(t.workspace_id, async () => {
    let prompt = t.prompt as string, preferred: string | null = t.instance_id;
    for (;;) {
      if (cancelled.has(taskId)) return setStatus(taskId, 'cancelled');
      const inst = await pickInstance(t.workspace_id, preferred);
      if (!inst) { setStatus(taskId, 'blocked', 'No eligible running instance'); logEvent('warn', 'task.blocked', taskId); return; }
      db.prepare('update tasks set instance_id=?, attempts=attempts+1 where id=?').run(inst.id, taskId);
      setStatus(taskId, 'running'); addEvent(taskId, 'start', inst.name);
      let tail = '', code = -1;
      try {
        code = await execStream(inst.container_id, ['sh', '-c', `echo $$ > /tmp/task-${taskId}.pid; exec opencode run ${q(prompt)}`], chunk => {
          tail = (tail + chunk).slice(-20000); addEvent(taskId, 'output', chunk);
          bus.emit('event', { type: 'task_output', taskId, data: chunk });
        });
      } catch (e) { tail += String(e); }
      if (cancelled.has(taskId)) return setStatus(taskId, 'cancelled', null, code);
      if (code === 0) { logEvent('info', 'task.done', taskId); return setStatus(taskId, 'done', null, 0); }
      if (QUOTA.test(tail)) {
        db.prepare('update instances set exhausted_until=? where id=?').run(Date.now() + config.cooldownMs, inst.id);
        const cp = await checkpoint(taskId, inst, tail);
        logEvent('warn', 'quota.detected', `${inst.name} task ${taskId}`);
        if (!config.autoSwitch) { setStatus(taskId, 'blocked', 'Usage limit hit; AUTO_SWITCH disabled (resume manually)', code); return; }
        if (!(await pickInstance(t.workspace_id))) {
          if (!(await spawnForQuota(t.workspace_id))) { setStatus(taskId, 'blocked', 'Usage limit hit and no new container could be started (add a credential profile)', code); return; }
        }
        prompt = resumePrompt(t.prompt, cp); preferred = null;
        logEvent('info', 'task.switching', `${inst.name} -> next eligible`);
        continue;
      }
      logEvent('error', 'task.failed', `${taskId} exit ${code}`);
      return setStatus(taskId, 'failed', tail.slice(-500), code);
    }
  });
}
export async function cancelTask(id: string) {
  const t = db.prepare('select * from tasks where id=?').get(id) as Row; if (!t) throw new Error('Unknown task');
  cancelled.add(id);
  if (t.status === 'running' && t.instance_id) {
    const inst = db.prepare('select * from instances where id=?').get(t.instance_id) as Row;
    await execCapture(inst.container_id, ['sh', '-c', `kill $(cat /tmp/task-${id}.pid) 2>/dev/null; true`]).catch(() => {});
  } else if (t.status === 'queued' || t.status === 'blocked') setStatus(id, 'cancelled');
}
export function resumeTask(id: string) {
  const t = db.prepare('select * from tasks where id=?').get(id) as Row; if (!t) throw new Error('Unknown task');
  const cp = db.prepare('select * from checkpoints where task_id=? order by ts desc limit 1').get(id) as Row | undefined;
  const prompt = cp ? resumePrompt(t.prompt, { summary: cp.summary, tail: cp.output_tail }) : t.prompt;
  return submitTask(t.workspace_id, prompt, undefined, id);
}
export const recoverOnBoot = () => {
  const n = db.prepare("update tasks set status='interrupted', updated_at=? where status in ('running','queued')").run(Date.now()).changes;
  if (n) logEvent('warn', 'task.interrupted', `${n} task(s) interrupted by backend restart; use Resume`);
};
