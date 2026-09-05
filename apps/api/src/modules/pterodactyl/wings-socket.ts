import WebSocket from 'ws';
import type { Logger } from '../../lib/logger.js';
import { BaseConsoleHub, mapPowerState, type LiveStats } from './console-hub.js';

type WebsocketCredentials = { token: string; socket: string };

type WingsMessage = { event?: string; args?: unknown[] };

const CREDENTIAL_TIMEOUT_MS = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/** Wings tokens last 10 minutes; refresh well before the warning arrives. */
const TOKEN_REFRESH_MS = 8 * 60_000;

/**
 * Keeps one authenticated Wings websocket open for the server and republishes
 * everything it emits: console output (including the SteamCMD/mod-download
 * phase that never reaches the game's own log file), install output, power
 * state transitions, and resource frames.
 *
 * One upstream connection is shared by every panel viewer, and the base class
 * keeps a line backlog so a browser attaching mid-session immediately sees
 * context instead of an empty pane.
 */
export class WingsConsoleHub extends BaseConsoleHub {
  private socket: WebSocket | null = null;
  private stopped = true;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey: string;
      serverId: string;
      logger: Logger;
      fetchImpl?: typeof fetch;
    },
  ) {
    super();
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.refreshTimer = setInterval(() => void this.reauthenticate(), TOKEN_REFRESH_MS);
    this.refreshTimer.unref?.();
    void this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.reconnectTimer = null;
    this.refreshTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.setConnected(false);
    socket?.close();
  }

  /** Fetches a fresh websocket token from the Pterodactyl client API. */
  private async fetchCredentials(): Promise<WebsocketCredentials> {
    const url = `${this.baseUrl}/api/client/servers/${encodeURIComponent(
      this.options.serverId,
    )}/websocket`;
    const response = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(CREDENTIAL_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`websocket credentials returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as { data?: { token?: string; socket?: string } };
    const token = body.data?.token;
    const socket = body.data?.socket;
    if (!token || !socket) throw new Error('websocket credentials response was incomplete');
    return { token, socket };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempt);
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 5);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.socket) return;
    let credentials: WebsocketCredentials;
    try {
      credentials = await this.fetchCredentials();
    } catch (error) {
      this.options.logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'wings websocket credentials failed',
      );
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;

    // Wings only upgrades connections whose Origin matches the panel URL
    // (see wings router/websocket GetHandler.CheckOrigin), which is why this
    // uses `ws` rather than Node's built-in WebSocket.
    const socket = new WebSocket(credentials.socket, { origin: this.baseUrl });
    this.socket = socket;

    socket.on('open', () => {
      this.reconnectAttempt = 0;
      this.setConnected(true);
      this.send(socket, 'auth', credentials.token);
    });

    socket.on('message', (raw: WebSocket.RawData) => this.handleMessage(String(raw)));

    socket.on('error', (error: Error) => {
      this.options.logger.debug({ err: error.message }, 'wings websocket error');
    });

    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      this.setConnected(false);
      this.scheduleReconnect();
    });
  }

  private send(socket: WebSocket, event: string, ...args: string[]): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ event, args }));
  }

  /** Re-auths the live socket with a fresh token before the old one expires. */
  private async reauthenticate(): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      const { token } = await this.fetchCredentials();
      this.send(socket, 'auth', token);
    } catch (error) {
      this.options.logger.debug(
        { err: error instanceof Error ? error.message : String(error) },
        'wings token refresh failed',
      );
    }
  }

  private handleMessage(raw: string): void {
    let message: WingsMessage;
    try {
      message = JSON.parse(raw) as WingsMessage;
    } catch {
      return;
    }
    const arg = typeof message.args?.[0] === 'string' ? (message.args[0] as string) : '';

    switch (message.event) {
      case 'auth success':
        // Ask for the recent backlog and an immediate resource frame so the
        // panel is populated the moment it attaches.
        if (this.socket) {
          this.send(this.socket, 'send logs');
          this.send(this.socket, 'send stats');
        }
        break;
      case 'console output':
        this.pushOutput('console', arg);
        break;
      case 'install output':
        this.pushOutput('install', arg);
        break;
      case 'install started':
        this.pushOutput('daemon', 'Installation started.');
        break;
      case 'install completed':
        this.pushOutput('daemon', 'Installation completed.');
        break;
      case 'daemon message':
        this.pushOutput('daemon', arg);
        break;
      case 'daemon error':
      case 'jwt error':
        this.pushOutput('daemon', arg);
        void this.reauthenticate();
        break;
      case 'token expiring':
      case 'token expired':
        void this.reauthenticate();
        break;
      case 'status':
        this.setStatus(mapPowerState(arg));
        break;
      case 'stats':
        this.handleStats(arg);
        break;
      default:
        break;
    }
  }

  private handleStats(payload: string): void {
    let parsed: {
      state?: string;
      cpu_absolute?: number;
      memory_bytes?: number;
      disk_bytes?: number;
      uptime?: number;
      network?: { rx_bytes?: number; tx_bytes?: number };
    };
    try {
      parsed = JSON.parse(payload) as typeof parsed;
    } catch {
      return;
    }
    const stats: LiveStats = {
      status: mapPowerState(parsed.state),
      cpuPercent: parsed.cpu_absolute ?? 0,
      memoryBytes: parsed.memory_bytes ?? 0,
      diskBytes: parsed.disk_bytes ?? 0,
      networkRxBytes: parsed.network?.rx_bytes ?? 0,
      networkTxBytes: parsed.network?.tx_bytes ?? 0,
      uptimeMs: parsed.uptime ?? 0,
      at: Date.now(),
    };
    this.setStats(stats);
  }
}
