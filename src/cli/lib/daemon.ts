import { getCliForProvider, loadValidatedConfig, resolveModelForReview } from '../../config/model-config.js';
import { MesaDaemon } from '../../daemon/server.js';

export async function daemonStart(): Promise<number> {
  const existing = MesaDaemon.readPidFile();
  if (existing) {
    console.log(`[mesa] Daemon already running on port ${existing.port} (PID: ${existing.pid})`);
    return 0;
  }

  const config = loadValidatedConfig();
  const cli = getCliForProvider(config.model.provider);
  const model = resolveModelForReview(config, 'daemon');

  const daemon = new MesaDaemon({
    workers: config.daemon?.workers ?? 1,
    idleTimeout: config.daemon?.idle_timeout ?? 1800,
    agent: cli,
    model: model === 'default' ? undefined : model,
  });

  const port = await daemon.start();
  console.log(`[mesa] Daemon started on port ${port}`);

  // Graceful shutdown on signals
  const shutdown = () => {
    daemon.stop();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Keep process alive until stopped
  await new Promise(() => {});
  return 0;
}

export async function daemonStop(): Promise<number> {
  const pid = MesaDaemon.readPidFile();
  if (!pid) {
    console.log('[mesa] No daemon running');
    return 0;
  }

  try {
    process.kill(pid.pid, 'SIGTERM');
    console.log(`[mesa] Sent SIGTERM to daemon (PID: ${pid.pid})`);
  } catch {
    console.log('[mesa] Daemon process not found, cleaning up');
    MesaDaemon.cleanupStalePidFile();
  }
  return 0;
}

export function daemonStatus(): number {
  const pid = MesaDaemon.readPidFile();
  if (!pid) {
    console.log('[mesa] Daemon is not running');
    return 1;
  }

  console.log(`[mesa] Daemon running on port ${pid.port} (PID: ${pid.pid})`);
  console.log(`[mesa] Started at: ${pid.startedAt}`);
  return 0;
}
