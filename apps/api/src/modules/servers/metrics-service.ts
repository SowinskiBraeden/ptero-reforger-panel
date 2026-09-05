import type { ServerResources, ServerStatus } from '@reforger-panel/shared';
import type { ConsoleHub } from '../pterodactyl/console-hub.js';
import type { GameServerProvider, ProviderServerLimits } from '../pterodactyl/types.js';

/**
 * A Wings `stats` frame arrives roughly every two seconds. Anything older than
 * this is treated as gone stale and we fall back to the REST endpoint.
 */
const LIVE_MAX_AGE_MS = 10_000;

const NO_LIMITS: ProviderServerLimits = {
  cpuLimitPercent: null,
  memoryLimitBytes: null,
  diskLimitBytes: null,
};

/**
 * Single source of truth for "what is the server doing right now".
 *
 * Resource numbers previously came only from a 10-second REST poll, so every
 * tile and graph in the panel lagged reality and disagreed with what
 * Pterodactyl itself displayed. When the console hub is connected its pushed
 * frames are authoritative; the REST call remains as the fallback for when the
 * websocket is down or disabled.
 */
export class ServerMetricsService {
  constructor(
    private readonly provider: GameServerProvider,
    private readonly hub: ConsoleHub | null,
  ) {}

  private liveStats() {
    const stats = this.hub?.latestStats();
    if (!stats) return null;
    return Date.now() - stats.at <= LIVE_MAX_AGE_MS ? stats : null;
  }

  async getStatus(serverId: string): Promise<ServerStatus> {
    const live = this.liveStats();
    if (live) return live.status;
    const hubStatus = this.hub?.latestStatus();
    if (hubStatus && hubStatus !== 'unknown') return hubStatus;
    return this.provider.getServerStatus(serverId);
  }

  async getResources(serverId: string): Promise<ServerResources> {
    const live = this.liveStats();
    if (live) {
      const limits = await this.provider.getServerLimits(serverId).catch(() => NO_LIMITS);
      return {
        status: live.status,
        cpuPercent: live.cpuPercent,
        cpuLimitPercent: limits.cpuLimitPercent,
        memoryBytes: live.memoryBytes,
        memoryLimitBytes: limits.memoryLimitBytes,
        diskBytes: live.diskBytes,
        diskLimitBytes: limits.diskLimitBytes,
        networkRxBytes: live.networkRxBytes,
        networkTxBytes: live.networkTxBytes,
        uptimeMs: live.uptimeMs,
        fetchedAt: new Date(live.at).toISOString(),
        source: 'live',
      };
    }
    const resources = await this.provider.getServerResources(serverId);
    return { ...resources, fetchedAt: new Date().toISOString(), source: 'poll' };
  }
}
