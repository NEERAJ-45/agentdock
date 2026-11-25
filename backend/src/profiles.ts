import fs from 'node:fs'; import path from 'node:path';
import { config } from './config.js'; import { db } from './db.js';
// One folder per account under PROFILES_DIR. It is mounted as the new container's /config, so it can hold:
//   <name>/profile.env                  KEY=VALUE lines (e.g. ANTHROPIC_API_KEY=...)  -> injected as container env
//   <name>/data/opencode/auth.json      auth file from `opencode auth login` on that account (XDG_DATA_HOME=/config/data)
const VALID = /^[a-z0-9][a-z0-9-]{0,24}$/;
const names = (): string[] => {
  try { return fs.readdirSync(config.profilesDir, { withFileTypes: true }).filter(d => d.isDirectory() && VALID.test(d.name)).map(d => d.name).sort(); } catch { return []; }
};
const used = () => new Set((db.prepare('select profile from instances where profile is not null').all() as any[]).map(r => r.profile));
export const profileDir = (name: string) => {
  if (!VALID.test(name)) throw new Error('Invalid profile name');
  return path.join(path.resolve(config.profilesDir), name);
};
export function profileEnv(name: string): string[] {
  const f = path.join(profileDir(name), 'profile.env');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.includes('='));
}
export const nextFreeProfile = (): string | null => { const u = used(); return names().find(n => !u.has(n)) ?? null; };
export const listProfiles = () => { const u = used(); return names().map(name => ({ name, used: u.has(name) })); }; // names only, never secrets
