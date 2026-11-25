import { useEffect, useRef, useState } from 'react';
export const getToken = () => localStorage.getItem('token') ?? '';
export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch('/api' + path, { ...init, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + getToken(), ...(init.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j;
}
export const post = (p: string, body?: any) => api(p, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
export const wsUrl = (p: string) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${p}?token=${encodeURIComponent(getToken())}`;
export function useEvents(onEvent: (e: any) => void) {
  const cb = useRef(onEvent); cb.current = onEvent;
  useEffect(() => {
    let ws: WebSocket, stop = false;
    const open = () => { ws = new WebSocket(wsUrl('/ws/events')); ws.onmessage = m => cb.current(JSON.parse(m.data)); ws.onclose = () => !stop && setTimeout(open, 2000); };
    open(); return () => { stop = true; ws?.close(); };
  }, []);
}
export function usePoll<T>(path: string, ms = 4000, dep: any = 0) {
  const [data, setData] = useState<T | null>(null); const [err, setErr] = useState('');
  const load = () => api<T>(path).then(setData).catch(e => setErr(e.message));
  useEffect(() => { load(); const t = setInterval(load, ms); return () => clearInterval(t); }, [path, dep]);
  return { data, err, reload: load };
}
