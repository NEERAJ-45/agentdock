import { ReactNode, ButtonHTMLAttributes } from 'react';
export const Card = ({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) => (
  <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">{(title || right) && <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-zinc-300">{title}</h3>{right}</div>}{children}</div>);
export const Button = ({ variant = 'default', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'danger' | 'ghost' }) => (
  <button {...p} className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40 ${variant === 'danger' ? 'bg-red-600 hover:bg-red-500' : variant === 'ghost' ? 'border border-zinc-700 hover:bg-zinc-800' : 'bg-indigo-600 hover:bg-indigo-500'} ${className}`} />);
export const Input = (p: any) => <input {...p} className={`w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm ${p.className ?? ''}`} />;
export const Select = (p: any) => <select {...p} className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm" />;
const colors: Record<string, string> = { running: 'bg-emerald-500/20 text-emerald-300', done: 'bg-emerald-500/20 text-emerald-300', failed: 'bg-red-500/20 text-red-300', exited: 'bg-zinc-600/30 text-zinc-300',
  blocked: 'bg-amber-500/20 text-amber-300', interrupted: 'bg-amber-500/20 text-amber-300', queued: 'bg-sky-500/20 text-sky-300', cancelled: 'bg-zinc-600/30 text-zinc-300' };
export const Badge = ({ s }: { s: string }) => <span className={`rounded px-2 py-0.5 text-xs ${colors[s] ?? 'bg-zinc-700 text-zinc-300'}`}>{s}</span>;
export const bytes = (n: number) => (n / 1048576).toFixed(0) + ' MB';
