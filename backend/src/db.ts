import { DatabaseSync } from 'node:sqlite'; // built into Node >= 22.13 (no native build needed)
import fs from 'node:fs'; import path from 'node:path';
import { config } from './config.js';
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
create table if not exists workspaces(id text primary key, name text not null, path text not null unique, created_at integer);
create table if not exists instances(id text primary key, name text not null unique, container_id text, workspace_id text not null,
  status text, exhausted_until integer, created_at integer, profile text);
create table if not exists tasks(id text primary key, workspace_id text not null, instance_id text, prompt text not null,
  status text not null, exit_code integer, attempts integer default 0, parent_id text, error text, created_at integer, updated_at integer);
create table if not exists task_events(id integer primary key autoincrement, task_id text, kind text, data text, ts integer);
create table if not exists checkpoints(id text primary key, task_id text, instance_id text, git_ref text, summary text, output_tail text, ts integer);
create table if not exists events(id integer primary key autoincrement, ts integer, level text, type text, message text);
`);
try { db.exec('alter table instances add column profile text'); } catch {}
export type Row = any;
