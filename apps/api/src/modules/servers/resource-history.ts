import type { ResourceHistoryResponse, ResourceSample } from '@reforger-panel/shared';
import type { Logger } from '../../lib/logger.js';
import type { GameServerProvider } from '../pterodactyl/types.js';

export const SAMPLE_INTERVAL_SECONDS = 15;
const MAX_SAMPLES = 240; // ~1 hour window

type RawSample = ResourceSample & { rxTotal: number; txTotal: number };

/**
 * In-memory rolling window of resource usage for the dashboard graphs.
 * Network rates are derived from the provider's cumulative rx/tx counters;
 * history is intentionally not persisted (it is telemetry, not records).
 */
export class ResourceHistoryService {
  private samples = new Map<string, RawSample[]>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private servers: { serverId: string; providerServerId: string }[] = [];

  constructor(
    private readonly provider: GameServerProvider,
    private readonly logger: Logger,
    private readonly intervalSeconds: number = SAMPLE_INTERVAL_SECONDS,
  ) {}

  start(servers: { serverId: string; providerServerId: string }[]): void {
    this.servers = servers;
    void this.sampleAll();
    this.timer = setInterval(() => void this.sampleAll(), this.intervalSeconds * 1000);
    this.timer.unref?.();
    this.logger.info({ servers: servers.length }, 'resource history sampler started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async sampleAll(): Promise<void> {
    for (const server of this.servers) {
      try {
        await this.sampleOne(server.serverId, server.providerServerId);
      } catch {
        // Provider unreachable: record an offline-ish gap sample so graphs
        // show the outage instead of freezing on the last good value.
        this.push(server.serverId, {
          t: Date.now(),
          status: 'unknown',
          cpuPercent: 0,
          cpuLimitPercent: null,
          memoryBytes: 0,
          memoryLimitBytes: null,
          networkRxRate: 0,
          networkTxRate: 0,
          rxTotal: -1,
          txTotal: -1,
        });
      }
    }
  }

  private async sampleOne(serverId: string, providerServerId: string): Promise<void> {
    const resources = await this.provider.getServerResources(providerServerId);
    const previous = this.samples.get(serverId)?.at(-1);
    const now = Date.now();

    let networkRxRate = 0;
    let networkTxRate = 0;
    if (previous && previous.rxTotal >= 0 && now > previous.t) {
      const dtSeconds = (now - previous.t) / 1000;
      // Counters reset on server restart; clamp negative deltas to zero.
      networkRxRate = Math.max(0, (resources.networkRxBytes - previous.rxTotal) / dtSeconds);
      networkTxRate = Math.max(0, (resources.networkTxBytes - previous.txTotal) / dtSeconds);
    }

    this.push(serverId, {
      t: now,
      status: resources.status,
      cpuPercent: Math.round(resources.cpuPercent * 10) / 10,
      cpuLimitPercent: resources.cpuLimitPercent,
      memoryBytes: resources.memoryBytes,
      memoryLimitBytes: resources.memoryLimitBytes,
      networkRxRate: Math.round(networkRxRate),
      networkTxRate: Math.round(networkTxRate),
      rxTotal: resources.networkRxBytes,
      txTotal: resources.networkTxBytes,
    });
  }

  private push(serverId: string, sample: RawSample): void {
    const list = this.samples.get(serverId) ?? [];
    list.push(sample);
    if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES);
    this.samples.set(serverId, list);
  }

  history(serverId: string): ResourceHistoryResponse {
    const samples = (this.samples.get(serverId) ?? []).map(
      ({ rxTotal: _rx, txTotal: _tx, ...sample }) => sample,
    );
    return { samples, intervalSeconds: this.intervalSeconds };
  }
}
