import type {
  ConsoleBacklog,
  ConsoleLine,
  ConsoleLineStream,
  ServerStatus,
} from '@reforger-panel/shared';

/** Maps a hosting backend's power state onto the panel's status vocabulary. */
export function mapPowerState(state: string | undefined): ServerStatus {
  switch (state) {
    case 'running':
      return 'online';
    case 'offline':
      return 'offline';
    case 'starting':
      return 'starting';
    case 'stopping':
      return 'stopping';
    default:
      return 'unknown';
  }
}

/** A resource frame pushed by Wings, or synthesised by the mock provider. */
export type LiveStats = {
  status: ServerStatus;
  cpuPercent: number;
  memoryBytes: number;
  diskBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  uptimeMs: number;
  /** Unix ms the frame arrived. */
  at: number;
};

export type ConsoleEvent =
  | { type: 'line'; line: ConsoleLine }
  | { type: 'status'; status: ServerStatus }
  | { type: 'stats'; stats: LiveStats };

/**
 * A live feed of a game server's console, status and resource usage.
 *
 * The panel previously reconstructed "live" output by repeatedly downloading
 * the *game's* log file, which meant nothing was visible until the game itself
 * had started and created that file — the install, update and mod download
 * phases were invisible. A hub instead carries whatever the hosting backend is
 * emitting, in real time.
 */
export interface ConsoleHub {
  start(): void;
  stop(): Promise<void>;
  /** Returns an unsubscribe function. */
  subscribe(listener: (event: ConsoleEvent) => void): () => void;
  /** Recent lines plus current state, so a new viewer sees context instantly. */
  backlog(): ConsoleBacklog;
  latestStats(): LiveStats | null;
  latestStatus(): ServerStatus;
}

const MAX_BACKLOG_LINES = 2_000;

/**
 * Wings colourises console output with ANSI escapes; the panel styles lines
 * itself, so they are stripped before they reach the browser. Built from a
 * char code rather than a literal escape to keep this file plain ASCII.
 */
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, 'g');

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '');
}

/**
 * Shared line buffer, subscriber fan-out and state tracking. Both the real
 * Wings hub and the mock hub build on this.
 */
export abstract class BaseConsoleHub implements ConsoleHub {
  private readonly listeners = new Set<(event: ConsoleEvent) => void>();
  private readonly lines: ConsoleLine[] = [];
  private seq = 0;
  private status: ServerStatus = 'unknown';
  private stats: LiveStats | null = null;
  protected connected = false;

  abstract start(): void;
  abstract stop(): Promise<void>;

  subscribe(listener: (event: ConsoleEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  backlog(): ConsoleBacklog {
    return { lines: [...this.lines], status: this.status, connected: this.connected };
  }

  latestStats(): LiveStats | null {
    return this.stats;
  }

  latestStatus(): ServerStatus {
    return this.status;
  }

  private emit(event: ConsoleEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must never take the upstream feed down.
      }
    }
  }

  /** Splits on newlines and pushes each non-empty line into the ring buffer. */
  protected pushOutput(stream: ConsoleLineStream, chunk: string): void {
    const at = Date.now();
    for (const raw of stripAnsi(chunk).split(/\r?\n/)) {
      const text = raw.replace(/\r/g, '').trimEnd();
      if (!text) continue;
      const line: ConsoleLine = { seq: ++this.seq, stream, text, at };
      this.lines.push(line);
      this.emit({ type: 'line', line });
    }
    if (this.lines.length > MAX_BACKLOG_LINES) {
      this.lines.splice(0, this.lines.length - MAX_BACKLOG_LINES);
    }
  }

  protected setStatus(status: ServerStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit({ type: 'status', status });
  }

  protected setStats(stats: LiveStats): void {
    this.stats = stats;
    // Wings reports the state alongside every stats frame; trust it.
    this.setStatus(stats.status);
    this.emit({ type: 'stats', stats });
  }

  protected setConnected(connected: boolean): void {
    this.connected = connected;
  }
}
