import { randomUUID } from 'node:crypto';
import { db, Row } from './db.js'; import { docker } from './docker.js'; import { config } from './config.js';
import { getWorkspace } from './workspaces.js'; import { profileDir, profileEnv } from './profiles.js'; import { logEvent } from './bus.js';

export const getInstance = (id: string): Row => db.prepare('select * from instances where id=?').get(id);

export async function createInstance(name: string, workspaceId: string, profile?: string | null) {
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(name)) throw new Error('Name must be lowercase alphanumeric/dashes');
  const ws = getWorkspace(workspaceId); if (!ws) throw new Error('Unknown workspace');
  const id = randomUUID();
  const c = await docker.createContainer({
    name: `oc-${name}`, Image: config.image, Env: profile ? profileEnv(profile) : [], Labels: { 'agentdock': '1', instance: id },
    Healthcheck: { Test: ['CMD', 'opencode', '--version'], Interval: 30e9, Timeout: 10e9, Retries: 3 },
    HostConfig: {
      Binds: [`${ws.path}:/workspace:rw`, profile ? `${profileDir(profile)}:/config` : `oc-${name}-config:/config`], // workspace vs config mounts separated
      Memory: config.memory, NanoCpus: config.cpus * 1e9, PidsLimit: 512,
      CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'], RestartPolicy: { Name: 'unless-stopped' }, Init: true,
    },
  });
  db.prepare('insert into instances(id,name,container_id,workspace_id,status,exhausted_until,created_at,profile) values(?,?,?,?,?,?,?,?)').run(id, name, c.id, workspaceId, 'created', null, Date.now(), profile ?? null);
  await c.start();
  logEvent('info', 'instance.created', `${name} (${ws.name})`);
  return refresh(getInstance(id));
}
async function refresh(row: Row) {
  let status = 'missing', health: string | null = null;
  try { const i = await docker.getContainer(row.container_id).inspect(); status = i.State.Status; health = (i.State as any).Health?.Status ?? null; } catch {}
  if (status !== row.status) db.prepare('update instances set status=? where id=?').run(status, row.id);
  return { ...row, status, health, exhausted: !!row.exhausted_until && row.exhausted_until > Date.now() };
}
export const listInstances = async () => Promise.all((db.prepare('select * from instances order by created_at').all() as Row[]).map(refresh));
export async function control(id: string, action: 'start' | 'stop' | 'restart') {
  const row = getInstance(id); if (!row) throw new Error('Unknown instance');
  const c = docker.getContainer(row.container_id);
  await (action === 'start' ? c.start() : action === 'stop' ? c.stop({ t: 10 }) : c.restart({ t: 10 }));
  logEvent('info', `instance.${action}`, row.name);
  return refresh(getInstance(id));
}
export async function removeInstance(id: string) {
  const row = getInstance(id); if (!row) return;
  if (db.prepare("select 1 from tasks where instance_id=? and status='running'").get(id)) throw new Error('Instance has a running task');
  await docker.getContainer(row.container_id).remove({ force: true }).catch(() => {});
  db.prepare('delete from instances where id=?').run(id);
  logEvent('info', 'instance.removed', row.name);
}
export async function logs(id: string, tail = 200) {
  const row = getInstance(id); if (!row) throw new Error('Unknown instance');
  const b = await docker.getContainer(row.container_id).logs({ stdout: true, stderr: true, tail });
  return b.toString('utf8').replace(/[\x00-\x08]/g, '');
}
