import { randomUUID } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { docker } from './docker.js';
import { getInstance } from './instances.js';

// Persistent shell sessions over plain REST so the Next.js proxy can drive them.
// Same container/workspace the ProdigyAI agent uses, so you can auth OpenCode or poke around.

type Session = {
  id: string;
  instanceId: string;
  stream: Duplex;
  exec: { resize: (opts: { w: number; h: number }) => Promise<unknown> };
  buffer: string;
  total: number;
  exited: boolean;
  lastUsed: number;
};

const MAX_BUFFER = 200_000;
const sessions = new Map<string, Session>();

export async function openTerminal(instanceId: string) {
  const row = getInstance(instanceId);
  if (!row) throw new Error('Unknown instance');
  const container = docker.getContainer(row.container_id);
  const exec = await container.exec({
    Cmd: ['bash', '-l'],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    WorkingDir: '/workspace',
    Env: ['TERM=xterm-256color'],
  });
  const stream = (await exec.start({ hijack: true, stdin: true, Tty: true } as never)) as unknown as Duplex;

  const id = randomUUID();
  const session: Session = { id, instanceId, stream, exec, buffer: '', total: 0, exited: false, lastUsed: Date.now() };

  stream.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    session.buffer += text;
    session.total += text.length;
    if (session.buffer.length > MAX_BUFFER) session.buffer = session.buffer.slice(-MAX_BUFFER);
    session.lastUsed = Date.now();
  });
  stream.on('end', () => {
    if (session.exited) return;
    session.exited = true;
    const tail = '\r\n\x1b[90m[session ended]\x1b[0m\r\n';
    session.buffer += tail;
    session.total += tail.length;
  });
  stream.on('error', () => {
    session.exited = true;
  });

  sessions.set(id, session);
  return { id };
}

export function readTerminal(id: string, cursor = 0) {
  const session = sessions.get(id);
  if (!session) throw new Error('Unknown terminal session');
  session.lastUsed = Date.now();
  const safeCursor = Math.max(0, Math.min(cursor, session.total));
  const base = session.total - session.buffer.length;
  const from = Math.max(0, safeCursor - base);
  return { data: session.buffer.slice(from), cursor: session.total, exited: session.exited };
}

export function writeTerminal(id: string, data: string) {
  const session = sessions.get(id);
  if (!session) throw new Error('Unknown terminal session');
  if (session.exited) throw new Error('Terminal session ended');
  session.lastUsed = Date.now();
  session.stream.write(data);
  return { ok: true };
}

export function resizeTerminal(id: string, cols: number, rows: number) {
  const session = sessions.get(id);
  if (!session) return { ok: false };
  session.exec.resize({ w: cols, h: rows }).catch(() => {});
  return { ok: true };
}

export function closeTerminal(id: string) {
  const session = sessions.get(id);
  if (!session) return { ok: true };
  try {
    session.stream.write('exit\n');
  } catch {}
  try {
    session.stream.end();
  } catch {}
  try {
    session.stream.destroy();
  } catch {}
  sessions.delete(id);
  return { ok: true };
}

setInterval(() => {
  const cutoff = Date.now() - 15 * 60_000;
  for (const [id, session] of sessions) {
    if (session.lastUsed < cutoff) closeTerminal(id);
  }
}, 60_000).unref();
