import { EventEmitter } from 'node:events';
import { db } from './db.js';
export const bus = new EventEmitter();
export function logEvent(level: 'info' | 'warn' | 'error', type: string, message: string) {
  const ts = Date.now();
  db.prepare('insert into events(ts,level,type,message) values(?,?,?,?)').run(ts, level, type, message);
  console.log(JSON.stringify({ ts, level, type, message }));
  bus.emit('event', { type: 'log', ts, level, event: type, message });
}
