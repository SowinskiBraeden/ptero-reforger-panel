import { describe, expect, it } from 'vitest';
import { parseLogChunk } from './parser.js';

const HEADER = 'Log started 2026-07-04 10:00:00';

function line(time: string, category: string, message: string): string {
  return `${time}  ${category.padEnd(12)} : ${message}`;
}

const CONNECT_LINE = line(
  '10:05:01.123',
  'DEFAULT',
  "BattlEye Server: 'Player #1 Braeden (10.0.0.2:50241) connected'",
);
const GUID_LINE = line(
  '10:05:02.500',
  'DEFAULT',
  "BattlEye Server: 'Player #1 Braeden - GUID: 9f2ab04c11d9e0aa'",
);
const DISCONNECT_LINE = line(
  '10:45:09.001',
  'DEFAULT',
  "BattlEye Server: 'Player #1 Braeden disconnected'",
);

describe('parseLogChunk', () => {
  it('parses a player connect event with timestamp from the header date', () => {
    const result = parseLogChunk(`${HEADER}\n${CONNECT_LINE}\n`);
    expect(result.events).toHaveLength(1);
    const event = result.events[0]!;
    expect(event.type).toBe('player_connected');
    if (event.type === 'player_connected') {
      expect(event.playerName).toBe('Braeden');
      expect(event.playerNumber).toBe(1);
      expect(event.occurredAt.toISOString()).toBe('2026-07-04T10:05:01.123Z');
    }
  });

  it('parses disconnect events and identity (GUID) lines', () => {
    const result = parseLogChunk(`${HEADER}\n${CONNECT_LINE}\n${GUID_LINE}\n${DISCONNECT_LINE}\n`);
    expect(result.events.map((e) => e.type)).toEqual([
      'player_connected',
      'player_identity',
      'player_disconnected',
    ]);
    const identity = result.events[1]!;
    if (identity.type === 'player_identity') {
      expect(identity.externalPlayerId).toBe('9f2ab04c11d9e0aa');
    }
  });

  it('parses player names containing spaces and parentheses-free IPs', () => {
    const weird = line(
      '10:06:00.000',
      'DEFAULT',
      "BattlEye Server: 'Player #7 Sgt. Moss Jr (192.168.1.44:61022) connected'",
    );
    const result = parseLogChunk(`${HEADER}\n${weird}\n`);
    expect(result.events).toHaveLength(1);
    if (result.events[0]!.type === 'player_connected') {
      expect(result.events[0]!.playerName).toBe('Sgt. Moss Jr');
    }
  });

  it('parses engine-level authenticated-player identity lines (real log format)', () => {
    const backend = line(
      '12:57:48.941',
      'BACKEND',
      'Authenticated player: rplIdentity=0x00000000 identityId=33cd5666-3466-477c-aeb8-010df1978756 name=mcdazzzled',
    );
    const result = parseLogChunk(`${HEADER}\n${backend}\n`);
    expect(result.events).toHaveLength(1);
    const event = result.events[0]!;
    expect(event.type).toBe('player_identity');
    if (event.type === 'player_identity') {
      expect(event.playerName).toBe('mcdazzzled');
      expect(event.externalPlayerId).toBe('33cd5666-3466-477c-aeb8-010df1978756');
    }
  });

  it('detects server start lines', () => {
    const content = `${HEADER}\n${line('10:00:05.000', 'DEFAULT', 'Game successfully created.')}\n`;
    const result = parseLogChunk(content);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.type).toBe('server_started');
  });

  it('parses ServerAdminTools killfeed lines', () => {
    const kill = line(
      '10:12:30.000',
      'SCRIPT',
      'ServerAdminTools | Event serveradmintools_player_killed | player: Victim, instigator: Killer, friendly: false',
    );
    const result = parseLogChunk(`${HEADER}\n${kill}\n`);
    expect(result.events).toHaveLength(1);
    const event = result.events[0]!;
    expect(event.type).toBe('player_killed');
    if (event.type === 'player_killed') {
      expect(event.victimName).toBe('Victim');
      expect(event.killerName).toBe('Killer');
      expect(event.friendly).toBe(false);
    }
  });

  it('handles multiple simultaneous players', () => {
    const content = [
      HEADER,
      line('10:01:00.000', 'DEFAULT', "BattlEye Server: 'Player #1 Alpha (10.0.0.1:1) connected'"),
      line('10:01:01.000', 'DEFAULT', "BattlEye Server: 'Player #2 Bravo (10.0.0.2:2) connected'"),
      line(
        '10:01:02.000',
        'DEFAULT',
        "BattlEye Server: 'Player #3 Charlie (10.0.0.3:3) connected'",
      ),
      line('10:30:00.000', 'DEFAULT', "BattlEye Server: 'Player #2 Bravo disconnected'"),
      '',
    ].join('\n');
    const result = parseLogChunk(content);
    expect(result.events).toHaveLength(4);
    expect(result.events.filter((e) => e.type === 'player_connected')).toHaveLength(3);
  });

  it('ignores unknown lines safely and counts them', () => {
    const content = [
      HEADER,
      line('10:02:00.000', 'SCRIPT', 'SCR_BaseGameMode: match state changed'),
      line('10:02:01.000', 'NETWORK', '### Connection stats'),
      'complete garbage that matches nothing',
      CONNECT_LINE,
      '',
    ].join('\n');
    const result = parseLogChunk(content);
    expect(result.events).toHaveLength(1);
    expect(result.ignoredLineCount).toBe(3);
  });

  it('rejects invalid timestamps without crashing', () => {
    const content = `${HEADER}\n${line('25:99:99.000', 'DEFAULT', 'Game successfully created.')}\n${CONNECT_LINE}\n`;
    const result = parseLogChunk(content);
    expect(result.invalidTimestampCount).toBe(1);
    expect(result.events).toHaveLength(1);
  });

  it('returns the partial trailing line unparsed', () => {
    const partial = "10:50:00.100  DEFAULT      : BattlEye Server: 'Player #2 Sab";
    const result = parseLogChunk(`${HEADER}\n${CONNECT_LINE}\n${partial}`);
    expect(result.events).toHaveLength(1);
    expect(result.partialTrailingLine).toBe(partial);
  });

  it('rolls the date over at midnight', () => {
    const content = [
      'Log started 2026-07-04 23:58:00',
      line('23:59:30.000', 'DEFAULT', "BattlEye Server: 'Player #1 Alpha (10.0.0.1:1) connected'"),
      line('00:01:10.000', 'DEFAULT', "BattlEye Server: 'Player #1 Alpha disconnected'"),
      '',
    ].join('\n');
    const result = parseLogChunk(content);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]!.occurredAt.toISOString()).toBe('2026-07-04T23:59:30.000Z');
    expect(result.events[1]!.occurredAt.toISOString()).toBe('2026-07-05T00:01:10.000Z');
  });

  it('uses the fallback date when no header is present, without producing future timestamps', () => {
    const fallback = new Date('2026-07-05T00:10:00.000Z');
    const result = parseLogChunk(
      `${line('23:55:00.000', 'DEFAULT', 'Game successfully created.')}\n`,
      {
        fallbackDate: fallback,
      },
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.occurredAt.toISOString()).toBe('2026-07-04T23:55:00.000Z');
  });

  it('parses an empty chunk without events', () => {
    const result = parseLogChunk('');
    expect(result.events).toHaveLength(0);
    expect(result.completeLineCount).toBe(0);
    expect(result.partialTrailingLine).toBeNull();
  });
});
