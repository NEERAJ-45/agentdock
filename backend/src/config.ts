import path from 'node:path';
export const config = {
  port: +(process.env.PORT ?? 8080),
  token: process.env.API_TOKEN ?? '',
  image: process.env.OPENCODE_IMAGE ?? 'agentdock:latest',
  dbPath: process.env.DB_PATH ?? path.resolve('../data/runtime.db'),
  roots: (process.env.ALLOWED_WORKSPACE_ROOTS ?? '').split(';').map(s => s.trim()).filter(Boolean),
  memory: +(process.env.INSTANCE_MEMORY_MB ?? 2048) * 1024 * 1024,
  cpus: +(process.env.INSTANCE_CPUS ?? 2),
  cooldownMs: +(process.env.QUOTA_COOLDOWN_MIN ?? 60) * 60_000,
  profilesDir: process.env.PROFILES_DIR ?? path.resolve('../data/profiles'),
  instanceEnvFile: process.env.INSTANCE_ENV_FILE ?? '',
  network: process.env.INSTANCE_NETWORK ?? '',
  maxInstances: +(process.env.MAX_INSTANCES ?? 6),
  autoSwitch: process.env.AUTO_SWITCH === 'true',
};
if (config.token.length < 16) throw new Error('API_TOKEN must be set (>= 16 chars)');
if (!config.roots.length) throw new Error('ALLOWED_WORKSPACE_ROOTS must be set');
