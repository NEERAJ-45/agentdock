import Docker from 'dockerode';
import { PassThrough } from 'node:stream';
export const docker = new Docker(); // Windows named pipe / unix socket auto-detected

export async function execStream(containerId: string, cmd: string[], onChunk: (s: string) => void): Promise<number> {
  const ex = await docker.getContainer(containerId).exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true, WorkingDir: '/workspace' });
  const stream = await ex.start({ hijack: true, stdin: false });
  const out = new PassThrough();
  out.on('data', d => onChunk(d.toString()));
  docker.modem.demuxStream(stream, out, out);
  await new Promise<void>(r => stream.on('end', () => r()));
  return (await ex.inspect()).ExitCode ?? -1;
}
export async function execCapture(containerId: string, cmd: string[]) {
  let out = '';
  const code = await execStream(containerId, cmd, s => (out += s));
  return { code, out };
}
export async function stats(containerId: string) {
  const s: any = await docker.getContainer(containerId).stats({ stream: false });
  const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
  const sysDelta = s.cpu_stats.system_cpu_usage - s.precpu_stats.system_cpu_usage;
  const cpu = sysDelta > 0 ? (cpuDelta / sysDelta) * (s.cpu_stats.online_cpus || 1) * 100 : 0;
  const mem = (s.memory_stats.usage ?? 0) - (s.memory_stats.stats?.inactive_file ?? s.memory_stats.stats?.cache ?? 0);
  return { cpuPercent: +cpu.toFixed(1), memBytes: mem, memLimit: s.memory_stats.limit ?? 0, pids: s.pids_stats?.current ?? 0 };
}
