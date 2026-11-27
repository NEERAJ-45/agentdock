import Fastify from 'fastify'; import cors from '@fastify/cors'; import websocket from '@fastify/websocket';
import { timingSafeEqual } from 'node:crypto'; import { z } from 'zod';
import { config } from './config.js'; import { db, Row } from './db.js'; import { bus } from './bus.js';
import { docker, stats } from './docker.js';
import { listProfiles } from './profiles.js'; import * as ws from './workspaces.js'; import * as inst from './instances.js'; import * as tasks from './tasks.js'; import * as term from './terminals.js';

const app = Fastify({ logger: { level: 'info' } });
await app.register(cors, { origin: [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/] });
await app.register(websocket);
// Treat an empty JSON body as {} so body-less POST/DELETE calls (cancel, terminal, control) don't 400.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  const text = (body as string).trim();
  if (!text) return done(null, {});
  try { done(null, JSON.parse(text)); } catch (e) { done(e as Error); }
});

const ok = (t?: string) => { const a = Buffer.from(t ?? ''), b = Buffer.from(config.token); return a.length === b.length && timingSafeEqual(a, b); };
app.addHook('onRequest', async (req, reply) => {
  if (req.url === '/health') return;
  const bearer = req.headers.authorization?.replace(/^Bearer /, '');
  const qt = (req.query as any)?.token as string | undefined;
  if (!ok(bearer) && !ok(qt)) return reply.code(401).send({ error: 'unauthorized' });
});
app.setErrorHandler((e: any, _req, reply) => reply.code(e.statusCode ?? 400).send({ error: e.message }));

app.get('/health', async () => ({ ok: true }));
app.get('/api/runtime', async () => {
  const info = await docker.info(); const list = await inst.listInstances();
  return { dockerVersion: info.ServerVersion, cpus: info.NCPU, memTotal: info.MemTotal,
    instances: list.length, running: list.filter(i => i.status === 'running').length,
    tasksRunning: (db.prepare("select count(*) c from tasks where status='running'").get() as Row).c };
});
app.get('/api/workspaces', async () => ws.listWorkspaces());
app.post('/api/workspaces', async req => { const b = z.object({ name: z.string().min(1), path: z.string() }).parse(req.body); return ws.addWorkspace(b.name, b.path); });
app.delete('/api/workspaces/:id', async req => { ws.removeWorkspace((req.params as any).id); return { ok: true }; });
app.get('/api/instances', async () => inst.listInstances());
app.post('/api/instances', async req => { const b = z.object({ name: z.string(), workspaceId: z.string() }).parse(req.body); return inst.createInstance(b.name, b.workspaceId); });
app.post('/api/instances/:id/:action', async req => {
  const { id, action } = req.params as any;
  if (!['start', 'stop', 'restart'].includes(action)) throw new Error('bad action');
  return inst.control(id, action);
});
app.delete('/api/instances/:id', async req => { await inst.removeInstance((req.params as any).id); return { ok: true }; });
app.get('/api/instances/:id/stats', async req => { const r = inst.getInstance((req.params as any).id); if (!r) throw new Error('Unknown instance'); return stats(r.container_id); });
app.get('/api/instances/:id/logs', async req => ({ logs: await inst.logs((req.params as any).id) }));
app.post('/api/instances/:id/terminal', async req => term.openTerminal((req.params as any).id));
app.get('/api/terminals/:sid', async req => term.readTerminal((req.params as any).sid, +((req.query as any).cursor ?? 0) || 0));
app.post('/api/terminals/:sid/input', async req => { const b = z.object({ data: z.string() }).parse(req.body); return term.writeTerminal((req.params as any).sid, b.data); });
app.post('/api/terminals/:sid/resize', async req => { const b = z.object({ cols: z.number(), rows: z.number() }).parse(req.body); return term.resizeTerminal((req.params as any).sid, b.cols, b.rows); });
app.delete('/api/terminals/:sid', async req => term.closeTerminal((req.params as any).sid));
app.get('/api/tasks', async () => db.prepare('select * from tasks order by created_at desc limit 100').all());
app.post('/api/tasks', async req => { const b = z.object({ workspaceId: z.string(), prompt: z.string().min(1), instanceId: z.string().optional() }).parse(req.body); return tasks.submitTask(b.workspaceId, b.prompt, b.instanceId); });
app.get('/api/tasks/:id', async req => {
  const id = (req.params as any).id;
  return { task: db.prepare('select * from tasks where id=?').get(id),
    checkpoints: db.prepare('select * from checkpoints where task_id=? order by ts').all(id),
    output: (db.prepare("select data from task_events where task_id=? and kind='output' order by id").all(id) as Row[]).map(r => r.data).join('').slice(-50000) };
});
app.post('/api/tasks/:id/cancel', async req => { await tasks.cancelTask((req.params as any).id); return { ok: true }; });
app.post('/api/tasks/:id/resume', async req => tasks.resumeTask((req.params as any).id));
app.get('/api/profiles', async () => listProfiles());
app.get('/api/events', async () => db.prepare('select * from events order by id desc limit 200').all());
app.get('/ws/events', { websocket: true }, socket => {
  const h = (e: any) => socket.send(JSON.stringify(e)); bus.on('event', h); socket.on('close', () => bus.off('event', h));
});
app.get('/ws/terminal/:id', { websocket: true }, async (socket, req) => {
  const row = inst.getInstance((req.params as any).id); if (!row) return socket.close();
  const ex = await docker.getContainer(row.container_id).exec({ Cmd: ['bash'], AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: true, WorkingDir: '/workspace' });
  const stream = await ex.start({ hijack: true, stdin: true, Tty: true } as any);
  stream.on('data', (d: Buffer) => socket.send(d.toString())); stream.on('end', () => socket.close());
  socket.on('message', (m: Buffer) => {
    const msg = JSON.parse(m.toString());
    if (msg.t === 'in') stream.write(msg.d); else if (msg.t === 'resize') ex.resize({ h: msg.rows, w: msg.cols }).catch(() => {});
  });
  socket.on('close', () => stream.end());
});

tasks.recoverOnBoot();
await app.listen({ port: config.port, host: '127.0.0.1' }); // localhost only
