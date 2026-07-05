/**
 * Line patterns for Arma Reforger (Enfusion) server logs.
 *
 * These are based on observed community-documented output and the bundled
 * fixtures, NOT an official spec — Bohemia can change them between game
 * versions. All pattern knowledge lives in this file so new formats only
 * require touching the regexes below and adding a fixture. Unknown lines are
 * ignored safely and only counted in diagnostics.
 *
 * Canonical shapes targeted:
 *   Log started 2026-07-04 11:22:33
 *   11:24:01.001  DEFAULT      : BattlEye Server: 'Player #1 Braeden (10.0.0.2:50241) connected'
 *   11:24:03.500  DEFAULT      : BattlEye Server: 'Player #1 Braeden - GUID: 9f2ab04c11d9e0aa'
 *   11:52:09.114  DEFAULT      : BattlEye Server: 'Player #1 Braeden disconnected'
 *   11:22:35.123  DEFAULT      : Game successfully created.
 */

/** Header written at the top of console.log; provides the calendar date. */
export const LOG_HEADER_PATTERN =
  /^Log started\s+(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;

/** Enfusion line prefix: time-of-day, category, colon, message. */
export const LINE_PREFIX_PATTERN = /^(\d{1,2}):(\d{2}):(\d{2})\.(\d{3})\s+([A-Z]+)\s*:\s*(.*)$/;

/** BattlEye messages are quoted inside a wrapper on the DEFAULT channel. */
export const BATTLEYE_WRAPPER_PATTERN = /^BattlEye Server: '(.*)'$/;

/** Player #1 Name (1.2.3.4:56789) connected */
export const PLAYER_CONNECTED_PATTERN =
  /^Player #(\d+) (.+) \((?:\d{1,3}\.){3}\d{1,3}:\d+\) connected$/;

/** Player #1 Name disconnected  (optionally with a trailing reason in parentheses) */
export const PLAYER_DISCONNECTED_PATTERN = /^Player #(\d+) (.+?) disconnected(?: \((.+)\))?$/;

/** Player #1 Name - GUID: abcdef0123456789  (also matches "- BE GUID:") */
export const PLAYER_GUID_PATTERN = /^Player #(\d+) (.+) - (?:BE )?GUID: ([0-9a-fA-F]{8,64})$/;

/**
 * Engine-level identity on the BACKEND channel (verified against real logs):
 *   Authenticated player: rplIdentity=0x00000000 identityId=<uuid> name=<name>
 * Available even when BattlEye is disabled.
 */
export const AUTHENTICATED_PLAYER_PATTERN =
  /^Authenticated player: .*identityId=([0-9a-fA-F-]{8,64}) name=(.+)$/;

/** Messages that indicate the server process finished starting a session. */
export const SERVER_STARTED_PATTERNS: RegExp[] = [
  /^Game successfully created\.?$/,
  /^Server is ready to accept connections/,
];

/**
 * ServerAdminTools killfeed line observed in reforger-stats:
 *   ServerAdminTools | Event serveradmintools_player_killed | player: Victim, instigator: Killer, friendly: false
 */
export const SERVER_ADMIN_TOOLS_KILL_PATTERN =
  /^ServerAdminTools \| Event serveradmintools_player_killed \| player: (.+), instigator: (.+), friendly: (true|false)$/i;
