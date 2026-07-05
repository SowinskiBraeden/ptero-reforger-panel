export type ParsedLogEvent =
  | {
      type: 'player_connected';
      occurredAt: Date;
      playerName: string;
      playerNumber?: number;
      externalPlayerId?: string;
      rawLine: string;
    }
  | {
      type: 'player_disconnected';
      occurredAt: Date;
      playerName: string;
      playerNumber?: number;
      externalPlayerId?: string;
      reason?: string;
      rawLine: string;
    }
  | {
      /**
       * Identity lines (e.g. BattlEye GUID) arrive separately from connects;
       * ingestion merges them into the matching player record.
       */
      type: 'player_identity';
      occurredAt: Date;
      playerName: string;
      playerNumber?: number;
      externalPlayerId: string;
      rawLine: string;
    }
  | {
      type: 'server_started';
      occurredAt: Date;
      rawLine: string;
    }
  | {
      type: 'player_killed';
      occurredAt: Date;
      victimName: string;
      killerName: string;
      friendly: boolean;
      rawLine: string;
    };

export type ParserContext = {
  /** Calendar date the time-of-day stamps are relative to (from the log header). */
  baseDate: Date | null;
  /** Last timestamp emitted; used to detect midnight rollover. */
  lastTimestamp: Date | null;
};

export type ParseChunkResult = {
  events: ParsedLogEvent[];
  completeLineCount: number;
  /** Lines that matched no pattern. Safe to ignore; counted for diagnostics only. */
  ignoredLineCount: number;
  invalidTimestampCount: number;
  /** Content after the final newline — not parsed, carried to the next sync. */
  partialTrailingLine: string | null;
  /** Raw text of the last complete line, for cursor continuity checks. */
  lastCompleteLine: string | null;
  context: ParserContext;
};
