import { useState } from 'react';
import { api, post, usePoll, useEvents, getToken } from './api'; import { Card, Button, Input, Select, Badge, bytes } from './ui'; import Term from './Terminal';

const tabs = ['Dashboard', 'Instances', 'Workspaces', 'Console', 'Tasks', 'Logs'] as const;
export default function App() {
  const [token, setToken] = useState(getToken()); const [tab, setTab] = useState<typeof tabs[number]>('Dashboard'); const [tick, setTick] = useState(0);
  useEvents(e => { if (e.type === 'task_status' || e.type === 'log') setTick(t => t + 1); });
  if (!token) return <Login onDone={t => { localStorage.setItem('token', t); setToken(t); }} />;
  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-center justify-between"><h1 className="text-xl font-bold">AgentDock</h1>
        <Button variant="ghost" onClick={() => { localStorage.removeItem('token'); setToken(''); }}>Sign out</Button></header>
      <nav className="mb-6 flex gap-1 border-b border-zinc-800">{tabs.map(t => <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm ${tab === t ? 'border-b-2 border-indigo-500 text-white' : 'text-zinc-400'}`}>{t}</button>)}</nav>
      {tab === 'Dashboard' && <Dashboard tick={tick} />}{tab === 'Instances' && <Instances tick={tick} />}{tab === 'Workspaces' && <Workspaces />}
      {tab === 'Console' && <Console />}{tab === 'Tasks' && <Tasks tick={tick} />}{tab === 'Logs' && <Logs tick={tick} />}
    </div>);
}
function Login({ onDone }: { onDone: (t: string) => void }) {
  const [t, setT] = useState('');
  return <div className="mx-auto mt-32 max-w-sm"><Card title="API token"><div className="space-y-3"><Input type="password" value={t} onChange={e => setT(e.target.value)} placeholder="API_TOKEN from backend/.env" /><Button onClick={() => onDone(t)}>Sign in</Button></div></Card></div>;
}
function Dashboard({ tick }: { tick: number }) {
  const rt = usePoll<any>('/runtime', 5000, tick); const ins = usePoll<any[]>('/instances', 5000, tick);
  return <div className="space-y-4">{rt.err && <p className="text-red-400">{rt.err}</p>}
    <div className="grid grid-cols-4 gap-4">{[['Docker', rt.data?.dockerVersion], ['Instances', rt.data?.instances], ['Running', rt.data?.running], ['Active tasks', rt.data?.tasksRunning]].map(([k, v]) => <Card key={k as string}><div className="text-xs text-zinc-400">{k}</div><div className="text-2xl font-semibold">{v ?? '-'}</div></Card>)}</div>
    <div className="grid grid-cols-2 gap-4">{ins.data?.filter(i => i.status === 'running').map(i => <Stat key={i.id} i={i} />)}</div></div>;
}
function Stat({ i }: { i: any }) {
  const s = usePoll<any>(`/instances/${i.id}/stats`, 3000);
  return <Card title={i.name} right={<Badge s={i.exhausted ? 'blocked' : i.status} />}>{s.data ? <div className="text-sm text-zinc-300">CPU {s.data.cpuPercent}% · Mem {bytes(s.data.memBytes)} / {bytes(s.data.memLimit)} · PIDs {s.data.pids}</div> : '...'}</Card>;
}
function Instances({ tick }: { tick: number }) {
  const ins = usePoll<any[]>('/instances', 4000, tick); const wss = usePoll<any[]>('/workspaces', 10000); const prof = usePoll<any[]>('/profiles', 10000);
  const [name, setName] = useState(''); const [wid, setWid] = useState(''); const [term, setTerm] = useState(''); const [logs, setLogs] = useState(''); const [err, setErr] = useState('');
  const act = (p: string, m = 'POST') => api(p, { method: m }).then(ins.reload).catch(e => setErr(e.message));
  return <div className="space-y-4">{err && <p className="text-red-400">{err}</p>}
    <Card title="Credential profiles (used for auto-spawned containers)"><div className="flex flex-wrap gap-2">{prof.data?.length ? prof.data.map(p => <span key={p.name} className="flex items-center gap-2 text-sm">{p.name} <Badge s={p.used ? 'running' : 'queued'} /><span className="text-xs text-zinc-500">{p.used ? 'in use' : 'free'}</span></span>) : <span className="text-sm text-zinc-500">None. Add folders under data/profiles/ (see README).</span>}</div></Card>
    <Card title="New instance"><div className="flex gap-2"><Input placeholder="name (e.g. acct-a)" value={name} onChange={e => setName(e.target.value)} />
      <Select value={wid} onChange={e => setWid(e.target.value)}><option value="">workspace…</option>{wss.data?.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
      <Button onClick={() => post('/instances', { name, workspaceId: wid }).then(() => { setName(''); ins.reload(); }).catch(e => setErr(e.message))}>Create</Button></div>
      <p className="mt-2 text-xs text-zinc-500">After creating, open the terminal and run <code>opencode auth login</code> to sign in that instance.</p></Card>
    {ins.data?.map(i => <Card key={i.id} title={i.name} right={<div className="flex items-center gap-2"><Badge s={i.exhausted ? 'blocked' : i.status} />{i.health && <span className="text-xs text-zinc-400">{i.health}</span>}</div>}>
      <div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => act(`/instances/${i.id}/start`)}>Start</Button><Button variant="ghost" onClick={() => act(`/instances/${i.id}/stop`)}>Stop</Button>
        <Button variant="ghost" onClick={() => act(`/instances/${i.id}/restart`)}>Restart</Button><Button variant="ghost" onClick={() => setTerm(term === i.id ? '' : i.id)}>Terminal</Button>
        <Button variant="ghost" onClick={() => api(`/instances/${i.id}/logs`).then(r => setLogs(r.logs))}>Logs</Button><Button variant="danger" onClick={() => confirm('Remove?') && act(`/instances/${i.id}`, 'DELETE')}>Remove</Button></div>
      {term === i.id && <div className="mt-3"><Term instanceId={i.id} /></div>}</Card>)}
    {logs && <Card title="Container logs"><pre className="max-h-72 overflow-auto text-xs">{logs}</pre></Card>}</div>;
}
function Workspaces() {
  const w = usePoll<any[]>('/workspaces', 10000); const [name, setName] = useState(''); const [path, setPath] = useState(''); const [err, setErr] = useState('');
  return <div className="space-y-4">{err && <p className="text-red-400">{err}</p>}
    <Card title="Register workspace"><div className="flex gap-2"><Input placeholder="name" value={name} onChange={e => setName(e.target.value)} /><Input placeholder="C:\Projects\my-app" value={path} onChange={e => setPath(e.target.value)} />
      <Button onClick={() => post('/workspaces', { name, path }).then(() => { setName(''); setPath(''); setErr(''); w.reload(); }).catch(e => setErr(e.message))}>Add</Button></div></Card>
    {w.data?.map(x => <Card key={x.id} title={x.name} right={<Button variant="danger" onClick={() => api(`/workspaces/${x.id}`, { method: 'DELETE' }).then(w.reload).catch(e => setErr(e.message))}>Remove</Button>}><code className="text-sm text-zinc-400">{x.path}</code></Card>)}</div>;
}
function Console() {
  const wss = usePoll<any[]>('/workspaces', 10000); const ins = usePoll<any[]>('/instances', 10000);
  const [wid, setWid] = useState(''); const [iid, setIid] = useState(''); const [prompt, setPrompt] = useState(''); const [taskId, setTaskId] = useState(''); const [out, setOut] = useState(''); const [status, setStatus] = useState(''); const [err, setErr] = useState('');
  useEvents(e => { if (e.taskId !== taskId) return; if (e.type === 'task_output') setOut(o => o + e.data); if (e.type === 'task_status') setStatus(e.status); });
  const submit = () => post('/tasks', { workspaceId: wid, prompt, instanceId: iid || undefined }).then(t => { setTaskId(t.id); setOut(''); setStatus(t.status); setErr(''); }).catch(e => setErr(e.message));
  return <div className="space-y-4">{err && <p className="text-red-400">{err}</p>}
    <Card title="Submit instruction"><div className="space-y-3"><div className="grid grid-cols-2 gap-2">
      <Select value={wid} onChange={e => setWid(e.target.value)}><option value="">workspace…</option>{wss.data?.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
      <Select value={iid} onChange={e => setIid(e.target.value)}><option value="">auto instance</option>{ins.data?.filter(i => i.workspace_id === wid).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</Select></div>
      <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={4} placeholder="Tell OpenCode what to do…" className="w-full rounded-md border border-zinc-700 bg-zinc-950 p-3 text-sm" />
      <Button disabled={!wid || !prompt} onClick={submit}>Run</Button></div></Card>
    {taskId && <Card title="Live output" right={<div className="flex items-center gap-2"><Badge s={status} /><Button variant="danger" onClick={() => post(`/tasks/${taskId}/cancel`)}>Cancel</Button></div>}><pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">{out || '…'}</pre></Card>}</div>;
}
function Tasks({ tick }: { tick: number }) {
  const t = usePoll<any[]>('/tasks', 4000, tick); const [sel, setSel] = useState<any>(null);
  return <div className="grid grid-cols-2 gap-4"><div className="space-y-2">{t.data?.map(x => <div key={x.id} onClick={() => api('/tasks/' + x.id).then(setSel)} className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900 p-3 hover:border-zinc-600">
    <div className="flex justify-between"><Badge s={x.status} /><span className="text-xs text-zinc-500">attempts {x.attempts}</span></div><p className="mt-2 truncate text-sm">{x.prompt}</p></div>)}</div>
    {sel && <Card title="Task detail" right={<div className="flex gap-2">{['blocked', 'interrupted', 'failed'].includes(sel.task.status) && <Button onClick={() => post(`/tasks/${sel.task.id}/resume`).then(() => setSel(null))}>Resume</Button>}</div>}>
      <p className="mb-2 text-sm">{sel.task.prompt}</p>{sel.task.error && <p className="mb-2 text-xs text-amber-300">{sel.task.error}</p>}
      <h4 className="mt-3 text-xs font-semibold text-zinc-400">Checkpoints ({sel.checkpoints.length})</h4>{sel.checkpoints.map((c: any) => <pre key={c.id} className="mt-1 max-h-32 overflow-auto rounded bg-zinc-950 p-2 text-xs">{new Date(c.ts).toLocaleString()} ref={c.git_ref ?? 'none'}{'\n'}{c.summary}</pre>)}
      <h4 className="mt-3 text-xs font-semibold text-zinc-400">Output</h4><pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 text-xs">{sel.output}</pre></Card>}</div>;
}
function Logs({ tick }: { tick: number }) {
  const e = usePoll<any[]>('/events', 5000, tick);
  return <Card title="Activity"><div className="space-y-1 font-mono text-xs">{e.data?.map(x => <div key={x.id} className={x.level === 'error' ? 'text-red-400' : x.level === 'warn' ? 'text-amber-300' : 'text-zinc-300'}>{new Date(x.ts).toLocaleTimeString()} [{x.type}] {x.message}</div>)}</div></Card>;
}
