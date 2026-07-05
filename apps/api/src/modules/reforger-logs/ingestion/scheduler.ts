import { ApiError } from '../../../lib/errors.js';
import type { Logger } from '../../../lib/logger.js';
import type { LogIngestionService, SyncStats } from './ingestion-service.js';
import type { LogPathResolver } from './log-path-resolver.js';

export type ScheduledServer = {
  serverId: string;
  providerServerId: string;
  /** Resolved on every sync so per-boot dated log folders are followed. */
  resolveLogPath: LogPathResolver;
};

const MAX_BACKOFF_MULTIPLIER = 8;

/**
 * Background polling loop. One timer per server, a per-server lock so syncs
 * never overlap, exponential backoff after consecutive failures (to avoid
 * hammering a broken Pterodactyl), and graceful shutdown that waits for
 * in-flight syncs.
 */
export class IngestionScheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private inFlight = new Map<string, Promise<void>>();
  private failureCounts = new Map<string, number>();
  private stopped = false;
  private lastResults = new Map<string, SyncStats>();

  constructor(
    private readonly service: LogIngestionService,
    private readonly logger: Logger,
    private readonly intervalMs: number,
  ) {}

  start(servers: ScheduledServer[]): void {
    for (const server of servers) {
      this.schedule(server, 1_000 + Math.floor(Math.random() * 2_000));
    }
    this.logger.info(
      { servers: servers.length, intervalSeconds: this.intervalMs / 1000 },
      'log ingestion scheduler started',
    );
  }

  /** Manually trigger a sync; shares the per-server lock with the poller. */
  async syncNow(server: ScheduledServer): Promise<SyncStats> {
    const existing = this.inFlight.get(server.serverId);
    if (existing) {
      await existing.catch(() => undefined);
    }
    let stats!: SyncStats;
    const run = (async () => {
      const logPath = await server.resolveLogPath();
      if (!logPath) {
        throw ApiError.notConfigured(
          'Could not locate the current Reforger log file. Check REFORGER_LOG_DIRECTORY / REFORGER_ADMIN_LOG_PATH.',
        );
      }
      stats = await this.service.sync(server.serverId, server.providerServerId, logPath);
    })();
    this.inFlight.set(server.serverId, run.catch(() => undefined) as Promise<void>);
    try {
      await run;
    } finally {
      this.inFlight.delete(server.serverId);
    }
    this.lastResults.set(server.serverId, stats);
    return stats;
  }

  getLastResult(serverId: string): SyncStats | null {
    return this.lastResults.get(serverId) ?? null;
  }

  private schedule(server: ScheduledServer, delayMs: number): void {
    if (this.stopped) return;
    const timer = setTimeout(() => void this.tick(server), delayMs);
    timer.unref?.();
    this.timers.set(server.serverId, timer);
  }

  private async tick(server: ScheduledServer): Promise<void> {
    if (this.stopped) return;
    if (this.inFlight.has(server.serverId)) {
      this.schedule(server, this.intervalMs);
      return;
    }
    const run = server
      .resolveLogPath()
      .then((logPath) => {
        if (!logPath) {
          throw new Error('no log path resolved');
        }
        return this.service.sync(server.serverId, server.providerServerId, logPath);
      })
      .then((stats) => {
        this.lastResults.set(server.serverId, stats);
        this.failureCounts.set(server.serverId, 0);
      })
      .catch(() => {
        const failures = (this.failureCounts.get(server.serverId) ?? 0) + 1;
        this.failureCounts.set(server.serverId, failures);
      });
    this.inFlight.set(server.serverId, run);
    await run;
    this.inFlight.delete(server.serverId);

    const failures = this.failureCounts.get(server.serverId) ?? 0;
    const multiplier = Math.min(2 ** failures, MAX_BACKOFF_MULTIPLIER);
    this.schedule(server, this.intervalMs * multiplier);
  }

  /** Stop scheduling and wait for any in-flight sync to finish. */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.allSettled(this.inFlight.values());
    this.logger.info('log ingestion scheduler stopped');
  }
}
