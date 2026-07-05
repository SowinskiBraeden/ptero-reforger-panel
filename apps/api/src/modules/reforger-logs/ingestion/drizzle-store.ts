import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import { schema } from '../../../db/client.js';
import type {
  CursorRecord,
  IngestionStore,
  NewServerEvent,
  OpenSessionRecord,
  PlayerRecord,
} from './types.js';

export class DrizzleIngestionStore implements IngestionStore {
  constructor(private readonly db: Db) {}

  async getCursor(serverId: string, logPath: string): Promise<CursorRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.logCursors)
      .where(and(eq(schema.logCursors.serverId, serverId), eq(schema.logCursors.logPath, logPath)));
    const row = rows[0];
    if (!row) return null;
    return {
      serverId: row.serverId,
      logPath: row.logPath,
      fileFingerprint: row.fileFingerprint,
      lastByteOffset: row.lastByteOffset,
      lastLineHash: row.lastLineHash,
      partialTrailingLine: row.partialTrailingLine,
      lastEventTimestamp: row.lastEventTimestamp,
      lastSuccessfulSyncAt: row.lastSuccessfulSyncAt,
      lastErrorAt: row.lastErrorAt,
      lastErrorMessage: row.lastErrorMessage,
    };
  }

  async saveCursor(cursor: CursorRecord): Promise<void> {
    await this.db
      .insert(schema.logCursors)
      .values(cursor)
      .onConflictDoUpdate({
        target: [schema.logCursors.serverId, schema.logCursors.logPath],
        set: {
          fileFingerprint: cursor.fileFingerprint,
          lastByteOffset: cursor.lastByteOffset,
          lastLineHash: cursor.lastLineHash,
          partialTrailingLine: cursor.partialTrailingLine,
          lastEventTimestamp: cursor.lastEventTimestamp,
          lastSuccessfulSyncAt: cursor.lastSuccessfulSyncAt,
          lastErrorAt: cursor.lastErrorAt,
          lastErrorMessage: cursor.lastErrorMessage,
        },
      });
  }

  async insertEventIfNew(
    event: NewServerEvent,
  ): Promise<{ created: boolean; eventId: string | null }> {
    const rows = await this.db
      .insert(schema.serverEvents)
      .values({
        serverId: event.serverId,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        playerId: event.playerId ?? null,
        playerSessionId: event.playerSessionId ?? null,
        summary: event.summary,
        payload: event.payload,
        sourceLogPath: event.sourceLogPath,
        sourceLineHash: event.sourceLineHash,
      })
      .onConflictDoNothing({
        target: [
          schema.serverEvents.serverId,
          schema.serverEvents.sourceLogPath,
          schema.serverEvents.sourceLineHash,
        ],
      })
      .returning({ id: schema.serverEvents.id });
    return { created: rows.length > 0, eventId: rows[0]?.id ?? null };
  }

  async findPlayerByExternalId(
    serverId: string,
    externalPlayerId: string,
  ): Promise<PlayerRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.players)
      .where(
        and(
          eq(schema.players.serverId, serverId),
          eq(schema.players.externalPlayerId, externalPlayerId),
        ),
      );
    return rows[0] ?? null;
  }

  async findPlayerByName(serverId: string, displayName: string): Promise<PlayerRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.players)
      .where(
        and(eq(schema.players.serverId, serverId), eq(schema.players.displayName, displayName)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async createPlayer(input: {
    serverId: string;
    displayName: string;
    externalPlayerId: string | null;
    seenAt: Date;
  }): Promise<PlayerRecord> {
    const [row] = await this.db
      .insert(schema.players)
      .values({
        serverId: input.serverId,
        displayName: input.displayName,
        externalPlayerId: input.externalPlayerId,
        firstSeenAt: input.seenAt,
        lastSeenAt: input.seenAt,
      })
      .returning();
    return row!;
  }

  async updatePlayer(
    playerId: string,
    patch: { externalPlayerId?: string; displayName?: string; lastSeenAt?: Date },
  ): Promise<void> {
    await this.db.update(schema.players).set(patch).where(eq(schema.players.id, playerId));
  }

  async getOpenSession(serverId: string, playerId: string): Promise<OpenSessionRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.playerSessions)
      .where(
        and(
          eq(schema.playerSessions.serverId, serverId),
          eq(schema.playerSessions.playerId, playerId),
          isNull(schema.playerSessions.disconnectedAt),
        ),
      );
    const row = rows[0];
    return row ? { id: row.id, playerId: row.playerId, connectedAt: row.connectedAt } : null;
  }

  async openSession(input: {
    serverId: string;
    playerId: string;
    connectedAt: Date;
    sourceLogPath: string;
  }): Promise<OpenSessionRecord> {
    const [row] = await this.db.insert(schema.playerSessions).values(input).returning();
    return { id: row!.id, playerId: row!.playerId, connectedAt: row!.connectedAt };
  }

  async closeSession(
    sessionId: string,
    input: { disconnectedAt: Date; durationSeconds: number; disconnectReason: string | null },
  ): Promise<void> {
    await this.db
      .update(schema.playerSessions)
      .set(input)
      .where(eq(schema.playerSessions.id, sessionId));
  }

  async closeAllOpenSessions(
    serverId: string,
    disconnectedAt: Date,
    reason: string,
  ): Promise<{ closed: number }> {
    const open = await this.db
      .select()
      .from(schema.playerSessions)
      .where(
        and(
          eq(schema.playerSessions.serverId, serverId),
          isNull(schema.playerSessions.disconnectedAt),
        ),
      );
    for (const session of open) {
      await this.closeSession(session.id, {
        disconnectedAt,
        durationSeconds: Math.max(
          0,
          Math.round((disconnectedAt.getTime() - session.connectedAt.getTime()) / 1000),
        ),
        disconnectReason: reason,
      });
    }
    return { closed: open.length };
  }
}
