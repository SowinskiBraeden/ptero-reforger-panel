import type { ServerEventType } from '@reforger-panel/shared';
import type { DownloadableFile } from '../../pterodactyl/types.js';

export type CursorRecord = {
  serverId: string;
  logPath: string;
  fileFingerprint: string | null;
  lastByteOffset: number;
  lastLineHash: string | null;
  partialTrailingLine: string | null;
  lastEventTimestamp: Date | null;
  lastSuccessfulSyncAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
};

export type PlayerRecord = {
  id: string;
  serverId: string;
  externalPlayerId: string | null;
  displayName: string;
};

export type OpenSessionRecord = {
  id: string;
  playerId: string;
  connectedAt: Date;
};

export type NewServerEvent = {
  serverId: string;
  eventType: ServerEventType;
  occurredAt: Date;
  playerId?: string | null;
  playerSessionId?: string | null;
  summary: string;
  payload: Record<string, unknown>;
  sourceLogPath: string;
  sourceLineHash: string;
};

/**
 * Persistence boundary for log ingestion. Production uses Drizzle/Postgres;
 * tests use an in-memory implementation.
 */
export interface IngestionStore {
  getCursor(serverId: string, logPath: string): Promise<CursorRecord | null>;
  saveCursor(cursor: CursorRecord): Promise<void>;

  /** Returns created=false when the dedupe key already exists. */
  insertEventIfNew(event: NewServerEvent): Promise<{ created: boolean; eventId: string | null }>;

  findPlayerByExternalId(serverId: string, externalPlayerId: string): Promise<PlayerRecord | null>;
  findPlayerByName(serverId: string, displayName: string): Promise<PlayerRecord | null>;
  createPlayer(input: {
    serverId: string;
    displayName: string;
    externalPlayerId: string | null;
    seenAt: Date;
  }): Promise<PlayerRecord>;
  updatePlayer(
    playerId: string,
    patch: { externalPlayerId?: string; displayName?: string; lastSeenAt?: Date },
  ): Promise<void>;

  getOpenSession(serverId: string, playerId: string): Promise<OpenSessionRecord | null>;
  openSession(input: {
    serverId: string;
    playerId: string;
    connectedAt: Date;
    sourceLogPath: string;
  }): Promise<OpenSessionRecord>;
  closeSession(
    sessionId: string,
    input: { disconnectedAt: Date; durationSeconds: number; disconnectReason: string | null },
  ): Promise<void>;
  /** Close every open session on the server (used when a fresh server start is seen). */
  closeAllOpenSessions(
    serverId: string,
    disconnectedAt: Date,
    reason: string,
  ): Promise<{ closed: number }>;
}

/** Source of log file bytes; production wraps the Pterodactyl provider. */
export interface LogSource {
  fetchLog(serverId: string, logPath: string, maxBytes: number): Promise<DownloadableFile>;
}
