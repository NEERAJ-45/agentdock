import { useEffect, useRef } from 'react'; import { Terminal } from '@xterm/xterm'; import { FitAddon } from '@xterm/addon-fit'; import { wsUrl } from './api';
export default function Term({ instanceId }: { instanceId: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = new Terminal({ fontSize: 13, theme: { background: '#09090b' } }); const fit = new FitAddon(); t.loadAddon(fit); t.open(el.current!); fit.fit();
    const ws = new WebSocket(wsUrl('/ws/terminal/' + instanceId));
    const size = () => { fit.fit(); ws.readyState === 1 && ws.send(JSON.stringify({ t: 'resize', cols: t.cols, rows: t.rows })); };
    ws.onopen = size; ws.onmessage = m => t.write(m.data); ws.onclose = () => t.write('\r\n[closed]');
    t.onData(d => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'in', d })));
    window.addEventListener('resize', size);
    return () => { window.removeEventListener('resize', size); ws.close(); t.dispose(); };
  }, [instanceId]);
  return <div ref={el} className="h-96 rounded-md border border-zinc-800 p-1" />;
}
