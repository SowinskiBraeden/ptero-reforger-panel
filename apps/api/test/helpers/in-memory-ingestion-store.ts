import { randomUUID } from 'node:crypto';
import type {
  CursorRecord,
  IngestionStore,
  LogSource,
  NewServerEvent,
  OpenSessionRecord,
  PlayerRecord,
} from '../../src/modules/reforger-logs/ingestion/types.js';
import type { DownloadableFile } from '../../src/modules/pterodactyl/types.js';

export type StoredSession = {
  id: string;
  serverId: string;
  playerId: string;
  connectedAt: Date;
  disconnectedAt: Date | null;
  durationSeconds: number | null;
  disconnectReason: string | null;
  sourceLogPath: string;
};

export type StoredEvent = NewServerEvent & { id: string };

export class InMemoryIngestionStore implements IngestionStore {
  cursors = new Map<string, CursorRecord>();
  events: StoredEvent[] = [];
  players: (PlayerRecord & { firstSeenAt: Date; lastSeenAt: Date })[] = [];
  sessions: StoredSession[] = [];

  async getCursor(serverId: string, logPath: string) {
    return this.cursors.get(`${serverId}:${logPath}`) ?? null;
  }

  async saveCursor(cursor: CursorRecord) {
    this.cursors.set(`${cursor.serverId}:${cursor.logPath}`, { ...cursor });
  }

  async insertEventIfNew(event: NewServerEvent) {
    const duplicate = this.events.find(
      (e) =>
        e.serverId === event.serverId &&
        e.sourceLogPath === event.sourceLogPath &&
        e.sourceLineHash === event.sourceLineHash,
    );
    if (duplicate) return { created: false, eventId: null };
    const stored = { ...event, id: randomUUID() };
    this.events.push(stored);
    return { created: true, eventId: stored.id };
  }

  async findPlayerByExternalId(serverId: string, externalPlayerId: string) {
    return (
      this.players.find(
        (p) => p.serverId === serverId && p.externalPlayerId === externalPlayerId,
      ) ?? null
    );
  }

  async findPlayerByName(serverId: string, displayName: string) {
    return (
      this.players.find((p) => p.serverId === serverId && p.displayName === displayName) ?? null
    );
  }

  async createPlayer(input: {
    serverId: string;
    displayName: string;
    externalPlayerId: string | null;
    seenAt: Date;
  }) {
    const player = {
      id: randomUUID(),
      serverId: input.serverId,
      displayName: input.displayName,
      externalPlayerId: input.externalPlayerId,
      firstSeenAt: input.seenAt,
      lastSeenAt: input.seenAt,
    };
    this.players.push(player);
    return player;
  }

  async updatePlayer(
    playerId: string,
    patch: { externalPlayerId?: string; displayName?: string; lastSeenAt?: Date },
  ) {
    const player = this.players.find((p) => p.id === playerId);
    if (player) Object.assign(player, patch);
  }

  async getOpenSession(serverId: string, playerId: string): Promise<OpenSessionRecord | null> {
    const session = this.sessions.find(
      (s) => s.serverId === serverId && s.playerId === playerId && s.disconnectedAt === null,
    );
    return session
      ? { id: session.id, playerId: session.playerId, connectedAt: session.connectedAt }
      : null;
  }

  async openSession(input: {
    serverId: string;
    playerId: string;
    connectedAt: Date;
    sourceLogPath: string;
  }) {
    const session: StoredSession = {
      id: randomUUID(),
      serverId: input.serverId,
      playerId: input.playerId,
      connectedAt: input.connectedAt,
      disconnectedAt: null,
      durationSeconds: null,
      disconnectReason: null,
      sourceLogPath: input.sourceLogPath,
    };
    this.sessions.push(session);
    return { id: session.id, playerId: session.playerId, connectedAt: session.connectedAt };
  }

  async closeSession(
    sessionId: string,
    input: { disconnectedAt: Date; durationSeconds: number; disconnectReason: string | null },
  ) {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (session) Object.assign(session, input);
  }

  async closeAllOpenSessions(serverId: string, disconnectedAt: Date, reason: string) {
    const open = this.sessions.filter((s) => s.serverId === serverId && s.disconnectedAt === null);
    for (const session of open) {
      session.disconnectedAt = disconnectedAt;
      session.durationSeconds = Math.max(
        0,
        Math.round((disconnectedAt.getTime() - session.connectedAt.getTime()) / 1000),
      );
      session.disconnectReason = reason;
    }
    return { closed: open.length };
  }

  openSessions(serverId: string) {
    return this.sessions.filter((s) => s.serverId === serverId && s.disconnectedAt === null);
  }
}

/** LogSource whose content can be mutated between syncs to simulate a live file. */
export class FakeLogSource implements LogSource {
  content = '';
  failWith: Error | null = null;

  async fetchLog(_serverId: string, logPath: string, maxBytes: number): Promise<DownloadableFile> {
    if (this.failWith) throw this.failWith;
    const buffer = Buffer.from(this.content, 'utf8');
    const trimmed =
      buffer.byteLength > maxBytes ? buffer.subarray(buffer.byteLength - maxBytes) : buffer;
    return {
      path: logPath,
      content: trimmed.toString('utf8'),
      totalSizeBytes: buffer.byteLength,
      contentStartOffset: buffer.byteLength - trimmed.byteLength,
      truncated: trimmed.byteLength < buffer.byteLength,
    };
  }
}
