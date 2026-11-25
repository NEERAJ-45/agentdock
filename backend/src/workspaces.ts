import fs from 'node:fs'; import path from 'node:path'; import { randomUUID } from 'node:crypto';
import { db, Row } from './db.js'; import { config } from './config.js'; import { logEvent } from './bus.js';
const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
const inside = (p: string, root: string) => { const n = norm(p), r = norm(root); return n === r || n.startsWith(r + path.sep); };
export function validatePath(p: string): string {
  if (!path.isAbsolute(p)) throw new Error('Path must be absolute');
  if (!config.roots.some(r => inside(p, r))) throw new Error('Path is outside ALLOWED_WORKSPACE_ROOTS');
  const real = fs.realpathSync(p); // resolve symlinks, then re-check
  if (!config.roots.some(r => inside(real, fs.existsSync(r) ? fs.realpathSync(r) : r))) throw new Error('Resolved path escapes allowed roots');
  if (!fs.statSync(real).isDirectory()) throw new Error('Not a directory');
  return real;
}
export const listWorkspaces = (): Row[] => db.prepare('select * from workspaces order by created_at').all();
export const getWorkspace = (id: string): Row => db.prepare('select * from workspaces where id=?').get(id);
export function addWorkspace(name: string, p: string) {
  const real = validatePath(p); const id = randomUUID();
  db.prepare('insert into workspaces values(?,?,?,?)').run(id, name, real, Date.now());
  logEvent('info', 'workspace.added', `${name} -> ${real}`);
  return getWorkspace(id);
}
export function removeWorkspace(id: string) {
  if (db.prepare('select 1 from instances where workspace_id=?').get(id)) throw new Error('Workspace has instances');
  db.prepare('delete from workspaces where id=?').run(id);
}
