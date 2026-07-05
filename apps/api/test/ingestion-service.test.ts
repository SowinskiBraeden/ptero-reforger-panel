import { beforeEach, describe, expect, it } from 'vitest';
import { LogIngestionService } from '../src/modules/reforger-logs/ingestion/ingestion-service.js';
import { createLogger } from '../src/lib/logger.js';
import { FakeLogSource, InMemoryIngestionStore } from './helpers/in-memory-ingestion-store.js';

const SERVER_ID = 'srv-1';
const PROVIDER_ID = 'ptero-1';
const LOG_PATH = '/profile/logs/console.log';

const HEADER = 'Log started 2026-07-04 10:00:00\n';

function connect(time: string, num: number, name: string): string {
  return `${time}  DEFAULT      : BattlEye Server: 'Player #${num} ${name} (10.0.0.${num}:5000) connected'\n`;
}
function guid(time: string, num: number, name: string, id: string): string {
  return `${time}  DEFAULT      : BattlEye Server: 'Player #${num} ${name} - GUID: ${id}'\n`;
}
function disconnect(time: string, num: number, name: string): string {
  return `${time}  DEFAULT      : BattlEye Server: 'Player #${num} ${name} disconnected'\n`;
}
function kill(time: string, victim: string, killer: string, friendly = false): string {
  return `${time}  SCRIPT       : ServerAdminTools | Event serveradmintools_player_killed | player: ${victim}, instigator: ${killer}, friendly: ${friendly ? 'true' : 'false'}\n`;
}

describe('LogIngestionService', () => {
  let store: InMemoryIngestionStore;
  let source: FakeLogSource;
  let service: LogIngestionService;

  beforeEach(() => {
    store = new InMemoryIngestionStore();
    source = new FakeLogSource();
    service = new LogIngestionService(source, store, createLogger('silent'), {
      maxDownloadBytes: 2 * 1024 * 1024,
    });
  });

  const sync = () => service.sync(SERVER_ID, PROVIDER_ID, LOG_PATH);

  it('creates players, events, and open sessions from connect lines', async () => {
    source.content =
      HEADER +
      connect('10:05:00.000', 1, 'Braeden') +
      guid('10:05:01.000', 1, 'Braeden', 'aabbccdd11223344');
    const result = await sync();

    expect(result.createdEvents).toBe(1);
    expect(store.players).toHaveLength(1);
    expect(store.players[0]!.externalPlayerId).toBe('aabbccdd11223344');
    expect(store.openSessions(SERVER_ID)).toHaveLength(1);
    expect(result.cursorReset).toBe(false);
  });

  it('closes sessions with duration on disconnect', async () => {
    source.content =
      HEADER + connect('10:00:10.000', 1, 'Braeden') + disconnect('10:42:10.000', 1, 'Braeden');
    await sync();

    expect(store.openSessions(SERVER_ID)).toHaveLength(0);
    const session = store.sessions[0]!;
    expect(session.durationSeconds).toBe(42 * 60);
  });

  it('tracks multiple simultaneous players', async () => {
    source.content =
      HEADER +
      connect('10:01:00.000', 1, 'Alpha') +
      connect('10:02:00.000', 2, 'Bravo') +
      connect('10:03:00.000', 3, 'Charlie') +
      disconnect('10:30:00.000', 2, 'Bravo');
    await sync();

    expect(store.players).toHaveLength(3);
    const open = store.openSessions(SERVER_ID);
    expect(open).toHaveLength(2);
    const openNames = open.map((s) => store.players.find((p) => p.id === s.playerId)!.displayName);
    expect(openNames.sort()).toEqual(['Alpha', 'Charlie']);
  });

  it('stores ServerAdminTools killfeed events', async () => {
    source.content = HEADER + kill('10:10:00.000', 'Victim', 'Killer');
    const result = await sync();

    expect(result.createdEvents).toBe(1);
    expect(store.events[0]!.eventType).toBe('player_killed');
    expect(store.events[0]!.payload).toMatchObject({
      killerName: 'Killer',
      victimName: 'Victim',
      friendly: false,
      distanceMeters: null,
      weapon: null,
    });
    expect(store.players.map((player) => player.displayName).sort()).toEqual(['Killer', 'Victim']);
  });

  it('does not duplicate events when the same content is synced twice', async () => {
    source.content = HEADER + connect('10:05:00.000', 1, 'Braeden');
    await sync();
    // Force a cursor reset by clearing the cursor: same lines get re-read.
    store.cursors.clear();
    const second = await sync();

    expect(second.createdEvents).toBe(0);
    expect(store.events).toHaveLength(1);
    expect(store.openSessions(SERVER_ID)).toHaveLength(1);
  });

  it('processes only appended content on subsequent syncs', async () => {
    source.content = HEADER + connect('10:05:00.000', 1, 'Braeden');
    const first = await sync();
    source.content += disconnect('10:45:00.000', 1, 'Braeden');
    const second = await sync();

    expect(first.createdEvents).toBe(1);
    expect(second.createdEvents).toBe(1);
    expect(second.cursorReset).toBe(false);
    expect(second.processedLines).toBe(1);
    expect(store.openSessions(SERVER_ID)).toHaveLength(0);
  });

  it('carries a partial trailing line across syncs and parses it once complete', async () => {
    const full = connect('10:05:00.000', 1, 'Braeden');
    source.content = HEADER + full.slice(0, 40); // mid-line
    const first = await sync();
    expect(first.createdEvents).toBe(0);

    source.content = HEADER + full;
    const second = await sync();
    expect(second.createdEvents).toBe(1);
    expect(store.events[0]!.eventType).toBe('player_connected');
  });

  it('handles log rotation: resets the cursor and ingests the new file without duplicates', async () => {
    source.content =
      HEADER + connect('10:05:00.000', 1, 'Braeden') + disconnect('11:00:00.000', 1, 'Braeden');
    await sync();
    expect(store.events).toHaveLength(2);

    // Rotation: much smaller replacement file with a fresh header.
    source.content = 'Log started 2026-07-04 11:30:00\n' + connect('11:31:00.000', 1, 'Sable');
    const afterRotation = await sync();

    expect(afterRotation.cursorReset).toBe(true);
    expect(afterRotation.createdEvents).toBe(1);
    expect(store.events).toHaveLength(3);
  });

  it('bounds the first sync of a huge file instead of importing full history', async () => {
    let old = HEADER;
    for (let i = 0; i < 30_000; i += 1) {
      old += `09:00:00.000  SCRIPT       : filler line ${i} ${'x'.repeat(20)}\n`;
    }
    source.content = old + connect('10:05:00.000', 1, 'Braeden');
    const result = await sync();

    expect(result.createdEvents).toBe(1);
    expect(result.processedLines).toBeLessThan(30_000);
  });

  it('closes orphaned sessions when a server start is detected', async () => {
    source.content = HEADER + connect('10:05:00.000', 1, 'Braeden');
    await sync();
    expect(store.openSessions(SERVER_ID)).toHaveLength(1);

    source.content += '11:00:00.000  DEFAULT      : Game successfully created.\n';
    const result = await sync();

    expect(store.openSessions(SERVER_ID)).toHaveLength(0);
    expect(store.sessions[0]!.disconnectReason).toBe('server_restart');
    expect(store.events.map((e) => e.eventType)).toContain('server_restart_detected');
    expect(result.updatedSessions).toBe(1);
  });

  it('closes a stale session when the same player reconnects without a disconnect', async () => {
    source.content = HEADER + connect('10:05:00.000', 1, 'Braeden');
    await sync();
    source.content += connect('12:00:00.000', 4, 'Braeden');
    await sync();

    const open = store.openSessions(SERVER_ID);
    expect(open).toHaveLength(1);
    expect(open[0]!.connectedAt.toISOString()).toBe('2026-07-04T12:00:00.000Z');
    const closed = store.sessions.find((s) => s.disconnectedAt !== null)!;
    expect(closed.disconnectReason).toBe('missed_disconnect');
  });

  it('records a sanitized error on the cursor when the download fails', async () => {
    source.failWith = new Error('connect ETIMEDOUT 10.1.2.3:443 with apiKey=secret123');
    await expect(sync()).rejects.toThrow();

    const cursor = await store.getCursor(SERVER_ID, LOG_PATH);
    expect(cursor?.lastErrorAt).toBeInstanceOf(Date);
    expect(cursor?.lastErrorMessage).not.toContain('secret123');
    expect(cursor?.lastSuccessfulSyncAt).toBeNull();

    // Recovery: the next successful sync clears the error.
    source.failWith = null;
    source.content = HEADER + connect('10:05:00.000', 1, 'Braeden');
    await sync();
    const recovered = await store.getCursor(SERVER_ID, LOG_PATH);
    expect(recovered?.lastErrorAt).toBeNull();
    expect(recovered?.lastSuccessfulSyncAt).toBeInstanceOf(Date);
  });

  it('keeps one player when the logs emit both identityId and BattlEye GUID', async () => {
    // Real logs emit BACKEND Authenticated (uuid) then the BE GUID line.
    source.content =
      HEADER +
      '10:04:59.941  BACKEND      : Authenticated player: rplIdentity=0x00000000 identityId=33cd5666-3466-477c-aeb8-010df1978756 name=Braeden\n' +
      connect('10:05:00.000', 1, 'Braeden') +
      guid('10:05:01.000', 1, 'Braeden', '8f1ec46b6979b3a3590e62aa8b757a68');
    await sync();

    expect(store.players).toHaveLength(1);
    // First identity wins; the GUID does not split the player.
    expect(store.players[0]!.externalPlayerId).toBe('33cd5666-3466-477c-aeb8-010df1978756');
    expect(store.openSessions(SERVER_ID)).toHaveLength(1);
  });

  it('merges identity lines that arrive in a later sync via open-session name match', async () => {
    source.content = HEADER + connect('10:05:00.000', 1, 'Braeden');
    await sync();
    source.content += guid('10:05:02.000', 1, 'Braeden', 'deadbeef00000001');
    await sync();

    expect(store.players).toHaveLength(1);
    expect(store.players[0]!.externalPlayerId).toBe('deadbeef00000001');
  });
});
