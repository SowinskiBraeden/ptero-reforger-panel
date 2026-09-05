import type { ServerStatus } from '@reforger-panel/shared';
import { BaseConsoleHub } from './console-hub.js';
import type { MockGameServerProvider } from './mock-provider.js';

const STATS_INTERVAL_MS = 2_000;

/**
 * Simulates the Wings feed so the whole panel — live console, status strip and
 * resource graphs — works under USE_MOCK_PTERODACTYL. The startup script
 * deliberately includes the update and mod-download phase, since that is the
 * part the real websocket exists to surface.
 */
const BOOT_SCRIPT: { delayMs: number; stream: 'console' | 'install' | 'daemon'; text: string }[] = [
  {
    delayMs: 100,
    stream: 'daemon',
    text: 'Pulling Docker container image, ensuring it is up to date.',
  },
  { delayMs: 600, stream: 'daemon', text: 'Finished pulling Docker container image.' },
  { delayMs: 900, stream: 'console', text: 'Redirecting stderr to stdout.' },
  {
    delayMs: 1200,
    stream: 'console',
    text: 'Update state (0x5) verifying install, progress: 46.12 (1039 / 2253)',
  },
  { delayMs: 1800, stream: 'console', text: 'Success! App "1874900" fully installed.' },
  {
    delayMs: 2200,
    stream: 'console',
    text: 'Downloading workshop mod 591AF5BDA9F7CE8B (Mock Sample Mod)',
  },
  {
    delayMs: 2900,
    stream: 'console',
    text: 'Mod 591AF5BDA9F7CE8B downloaded (4.2 MiB), verifying.',
  },
  {
    delayMs: 3300,
    stream: 'console',
    text: 'ENGINE      : Enfusion engine build: 1.3.0.42 (mock)',
  },
  { delayMs: 3700, stream: 'console', text: 'DEFAULT     : Loading world.' },
  { delayMs: 4100, stream: 'console', text: 'DEFAULT     : Game successfully created.' },
  { delayMs: 4300, stream: 'console', text: 'NETWORK     : Server is ready to accept connections' },
];

export class MockConsoleHub extends BaseConsoleHub {
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private bootTimers: ReturnType<typeof setTimeout>[] = [];
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly provider: MockGameServerProvider) {
    super();
  }

  start(): void {
    if (this.statsTimer) return;
    this.setConnected(true);
    this.setStatus(this.provider.currentStatus);
    this.unsubscribe = this.provider.onStatusChange((status) => this.onStatusChange(status));
    this.statsTimer = setInterval(() => void this.pushStats(), STATS_INTERVAL_MS);
    this.statsTimer.unref?.();
    void this.pushStats();
    this.pushOutput('daemon', 'Attached to mock Pterodactyl console.');
  }

  async stop(): Promise<void> {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    for (const timer of this.bootTimers) clearTimeout(timer);
    this.bootTimers = [];
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.setConnected(false);
  }

  private onStatusChange(status: ServerStatus): void {
    this.setStatus(status);
    if (status === 'starting') this.playBootScript();
    if (status === 'stopping') this.pushOutput('daemon', 'Stopping server container.');
    if (status === 'offline') this.pushOutput('daemon', 'Server marked as offline.');
  }

  private playBootScript(): void {
    for (const timer of this.bootTimers) clearTimeout(timer);
    this.bootTimers = BOOT_SCRIPT.map((step) => {
      const timer = setTimeout(() => this.pushOutput(step.stream, step.text), step.delayMs);
      timer.unref?.();
      return timer;
    });
  }

  private async pushStats(): Promise<void> {
    const resources = await this.provider.getServerResources();
    this.setStats({
      status: resources.status,
      cpuPercent: resources.cpuPercent,
      memoryBytes: resources.memoryBytes,
      diskBytes: resources.diskBytes,
      networkRxBytes: resources.networkRxBytes,
      networkTxBytes: resources.networkTxBytes,
      uptimeMs: resources.uptimeMs,
      at: Date.now(),
    });
  }
}
