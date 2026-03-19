import { getCliForProvider, loadValidatedConfig, resolveModelForReview } from '../../config/model-config.js';
import { SaguaroDaemon } from '../../daemon/server.js';
import { daemonStatsCommand } from '../lib/daemon-stats.js';
import type { TimeWindow } from '../../daemon/stats-types.js';

export async function daemonStart(): Promise<number> {
  const existing = SaguaroDaemon.readPidFile();
  if (existing) {
    console.log(`[sag] Daemon already running on port ${existing.port} (PID: ${existing.pid})`);
    return 0;
  }

  const config = loadValidatedConfig();
  const cli = getCliForProvider(config.model.provider);
  const model = resolveModelForReview(config, 'daemon');

  const daemon = new SaguaroDaemon({
    workers: config.daemon?.workers ?? 2,
    idleTimeout: config.daemon?.idle_timeout ?? 1800,
    agent: cli,
    model: model === 'default' ? undefined : model,
  });

  const port = await daemon.start();
  console.log(`[sag] Daemon started on port ${port}`);

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
  const pid = SaguaroDaemon.readPidFile();
  if (!pid) {
    console.log('[sag] No daemon running');
    return 0;
  }

  try {
    process.kill(pid.pid, 'SIGTERM');
    console.log(`[sag] Sent SIGTERM to daemon (PID: ${pid.pid})`);
  } catch {
    console.log('[sag] Daemon process not found, cleaning up');
    SaguaroDaemon.cleanupStalePidFile();
  }
  return 0;
}

export function daemonStatus(): number {
  const pid = SaguaroDaemon.readPidFile();
  if (!pid) {
    console.log('[sag] Daemon is not running');
    return 1;
  }

  console.log(`[sag] Daemon running on port ${pid.port} (PID: ${pid.pid})`);
  console.log(`[sag] Started at: ${pid.startedAt}`);
  return 0;
}

export function daemonStats(options: { window?: string }): number {
  const validWindows = ['1h', '1d', '7d', '30d', 'all'];
  const window: TimeWindow = validWindows.includes(options.window ?? '')
    ? (options.window as TimeWindow)
    : '7d';
  return daemonStatsCommand({ window });
}
