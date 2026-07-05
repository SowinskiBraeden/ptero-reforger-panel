import {
  AUTHENTICATED_PLAYER_PATTERN,
  BATTLEYE_WRAPPER_PATTERN,
  LINE_PREFIX_PATTERN,
  LOG_HEADER_PATTERN,
  PLAYER_CONNECTED_PATTERN,
  PLAYER_DISCONNECTED_PATTERN,
  PLAYER_GUID_PATTERN,
  SERVER_ADMIN_TOOLS_KILL_PATTERN,
  SERVER_STARTED_PATTERNS,
} from './patterns.js';
import type { ParseChunkResult, ParsedLogEvent, ParserContext } from './types.js';

const MIDNIGHT_ROLLOVER_TOLERANCE_MS = 60_000;

export function emptyContext(): ParserContext {
  return { baseDate: null, lastTimestamp: null };
}

function startOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Combine a time-of-day stamp with the tracked calendar date. Reforger's
 * console.log lines carry no date, so the date comes from the log header when
 * present, otherwise from the fallback (file time / now). Rollover past
 * midnight is detected by the clock going backwards.
 */
function resolveTimestamp(
  hours: number,
  minutes: number,
  seconds: number,
  millis: number,
  context: ParserContext,
  fallbackDate: Date,
): Date | null {
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  const base = context.baseDate ?? startOfDayUtc(fallbackDate);
  if (!context.baseDate) context.baseDate = base;

  let timestamp = new Date(
    base.getTime() + ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis,
  );
  // No header date + fallback of "today" can push pre-midnight lines into the
  // future when syncing just after midnight; pull them back a day.
  if (
    !context.lastTimestamp &&
    timestamp.getTime() > fallbackDate.getTime() + MIDNIGHT_ROLLOVER_TOLERANCE_MS
  ) {
    context.baseDate = new Date(base.getTime() - 24 * 60 * 60 * 1000);
    timestamp = new Date(timestamp.getTime() - 24 * 60 * 60 * 1000);
  }
  if (
    context.lastTimestamp &&
    timestamp.getTime() < context.lastTimestamp.getTime() - MIDNIGHT_ROLLOVER_TOLERANCE_MS
  ) {
    context.baseDate = new Date(base.getTime() + 24 * 60 * 60 * 1000);
    timestamp = new Date(timestamp.getTime() + 24 * 60 * 60 * 1000);
  }
  context.lastTimestamp = timestamp;
  return timestamp;
}

function parseMessage(message: string, occurredAt: Date, rawLine: string): ParsedLogEvent | null {
  const battleye = BATTLEYE_WRAPPER_PATTERN.exec(message);
  const body = battleye ? battleye[1]! : message;

  const connected = PLAYER_CONNECTED_PATTERN.exec(body);
  if (connected) {
    return {
      type: 'player_connected',
      occurredAt,
      playerNumber: Number(connected[1]),
      playerName: connected[2]!,
      rawLine,
    };
  }

  const authenticated = AUTHENTICATED_PLAYER_PATTERN.exec(body);
  if (authenticated) {
    return {
      type: 'player_identity',
      occurredAt,
      playerName: authenticated[2]!,
      externalPlayerId: authenticated[1]!.toLowerCase(),
      rawLine,
    };
  }

  const guid = PLAYER_GUID_PATTERN.exec(body);
  if (guid) {
    return {
      type: 'player_identity',
      occurredAt,
      playerNumber: Number(guid[1]),
      playerName: guid[2]!,
      externalPlayerId: guid[3]!.toLowerCase(),
      rawLine,
    };
  }

  const disconnected = PLAYER_DISCONNECTED_PATTERN.exec(body);
  if (disconnected) {
    return {
      type: 'player_disconnected',
      occurredAt,
      playerNumber: Number(disconnected[1]),
      playerName: disconnected[2]!,
      reason: disconnected[3] || undefined,
      rawLine,
    };
  }

  if (SERVER_STARTED_PATTERNS.some((pattern) => pattern.test(body))) {
    return { type: 'server_started', occurredAt, rawLine };
  }

  const kill = SERVER_ADMIN_TOOLS_KILL_PATTERN.exec(body);
  if (kill) {
    return {
      type: 'player_killed',
      occurredAt,
      victimName: kill[1]!,
      killerName: kill[2]!,
      friendly: kill[3]!.toLowerCase() === 'true',
      rawLine,
    };
  }

  return null;
}

/**
 * Parse a chunk of log content. The chunk must start at a line boundary
 * (callers prepend any stored partial trailing line). Pure and side-effect
 * free apart from the returned, updated context.
 */
export function parseLogChunk(
  content: string,
  options: { context?: ParserContext; fallbackDate?: Date } = {},
): ParseChunkResult {
  const context: ParserContext = options.context ? { ...options.context } : emptyContext();
  const fallbackDate = options.fallbackDate ?? new Date();

  const endsWithNewline = content.endsWith('\n');
  const segments = content.split('\n');
  const partialTrailingLine = endsWithNewline ? null : (segments.pop() ?? null);
  if (endsWithNewline) segments.pop(); // drop the empty segment after the final newline

  const events: ParsedLogEvent[] = [];
  let ignoredLineCount = 0;
  let invalidTimestampCount = 0;
  let lastCompleteLine: string | null = null;

  for (const rawSegment of segments) {
    const line = rawSegment.replace(/\r$/, '');
    lastCompleteLine = line;
    if (line.trim() === '') continue;

    const header = LOG_HEADER_PATTERN.exec(line);
    if (header) {
      const [, year, month, day, hours, minutes, seconds] = header;
      const headerDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0));
      if (!Number.isNaN(headerDate.getTime())) {
        context.baseDate = headerDate;
        context.lastTimestamp = new Date(
          Date.UTC(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hours),
            Number(minutes),
            Number(seconds),
          ),
        );
      }
      continue;
    }

    const prefix = LINE_PREFIX_PATTERN.exec(line);
    if (!prefix) {
      ignoredLineCount += 1;
      continue;
    }
    const [, h, m, s, ms, , message] = prefix;
    const occurredAt = resolveTimestamp(
      Number(h),
      Number(m),
      Number(s),
      Number(ms),
      context,
      fallbackDate,
    );
    if (!occurredAt) {
      invalidTimestampCount += 1;
      continue;
    }

    const event = parseMessage(message!, occurredAt, line);
    if (event) {
      events.push(event);
    } else {
      ignoredLineCount += 1;
    }
  }

  return {
    events,
    completeLineCount: segments.length,
    ignoredLineCount,
    invalidTimestampCount,
    partialTrailingLine: partialTrailingLine === '' ? null : partialTrailingLine,
    lastCompleteLine,
    context,
  };
}
