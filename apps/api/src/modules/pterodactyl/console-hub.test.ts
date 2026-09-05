import { describe, expect, it } from 'vitest';
import type { ConsoleEvent, LiveStats } from './console-hub.js';
import { BaseConsoleHub, mapPowerState, stripAnsi } from './console-hub.js';

const ESC = String.fromCharCode(27);

class TestHub extends BaseConsoleHub {
  start(): void {
    this.setConnected(true);
  }
  async stop(): Promise<void> {
    this.setConnected(false);
  }
  emitOutput(stream: 'console' | 'install' | 'daemon', chunk: string): void {
    this.pushOutput(stream, chunk);
  }
  emitStats(stats: LiveStats): void {
    this.setStats(stats);
  }
  emitStatus(status: Parameters<BaseConsoleHub['setStatus']>[0]): void {
    this.setStatus(status);
  }
}

function stats(overrides: Partial<LiveStats> = {}): LiveStats {
  return {
    status: 'online',
    cpuPercent: 38,
    memoryBytes: 1024,
    diskBytes: 2048,
    networkRxBytes: 10,
    networkTxBytes: 20,
    uptimeMs: 1000,
    at: Date.now(),
    ...overrides,
  };
}

describe('mapPowerState', () => {
  it('maps every Wings state, defaulting to unknown', () => {
    expect(mapPowerState('running')).toBe('online');
    expect(mapPowerState('starting')).toBe('starting');
    expect(mapPowerState('stopping')).toBe('stopping');
    expect(mapPowerState('offline')).toBe('offline');
    expect(mapPowerState(undefined)).toBe('unknown');
    expect(mapPowerState('something-new')).toBe('unknown');
  });
});

describe('stripAnsi', () => {
  it('removes the colour escapes Wings wraps console output in', () => {
    expect(stripAnsi(`${ESC}[0;32mSuccess!${ESC}[0m`)).toBe('Success!');
  });

  it('leaves plain text alone', () => {
    expect(stripAnsi('NETWORK : Server is ready')).toBe('NETWORK : Server is ready');
  });
});

describe('BaseConsoleHub', () => {
  it('splits chunks into lines and numbers them for de-duplication', () => {
    const hub = new TestHub();
    hub.emitOutput('console', 'first\r\nsecond\n\nthird\n');
    const lines = hub.backlog().lines;
    expect(lines.map((line) => line.text)).toEqual(['first', 'second', 'third']);
    expect(lines.map((line) => line.seq)).toEqual([1, 2, 3]);
  });

  it('keeps install output distinguishable from game output', () => {
    const hub = new TestHub();
    hub.emitOutput('install', 'Downloading mod 595F2BF2F44836FB');
    expect(hub.backlog().lines[0]!.stream).toBe('install');
  });

  it('replays the backlog and current state to a late subscriber', () => {
    const hub = new TestHub();
    hub.start();
    hub.emitOutput('console', 'boot line');
    hub.emitStatus('starting');
    const backlog = hub.backlog();
    expect(backlog.lines).toHaveLength(1);
    expect(backlog.status).toBe('starting');
    expect(backlog.connected).toBe(true);
  });

  it('fans events out to subscribers until they unsubscribe', () => {
    const hub = new TestHub();
    const events: ConsoleEvent[] = [];
    const unsubscribe = hub.subscribe((event) => events.push(event));

    hub.emitOutput('console', 'one');
    hub.emitStatus('online');
    unsubscribe();
    hub.emitOutput('console', 'two');

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'line' });
    expect(events[1]).toMatchObject({ type: 'status', status: 'online' });
  });

  it('does not re-emit an unchanged status', () => {
    const hub = new TestHub();
    const events: ConsoleEvent[] = [];
    hub.subscribe((event) => events.push(event));
    hub.emitStatus('online');
    hub.emitStatus('online');
    expect(events.filter((event) => event.type === 'status')).toHaveLength(1);
  });

  it('takes the status carried by a stats frame', () => {
    const hub = new TestHub();
    hub.emitStats(stats({ status: 'starting' }));
    expect(hub.latestStatus()).toBe('starting');
    expect(hub.latestStats()?.cpuPercent).toBe(38);
  });

  it('a throwing subscriber cannot break the feed for others', () => {
    const hub = new TestHub();
    const seen: string[] = [];
    hub.subscribe(() => {
      throw new Error('bad subscriber');
    });
    hub.subscribe((event) => {
      if (event.type === 'line') seen.push(event.line.text);
    });
    hub.emitOutput('console', 'still delivered');
    expect(seen).toEqual(['still delivered']);
  });
});
