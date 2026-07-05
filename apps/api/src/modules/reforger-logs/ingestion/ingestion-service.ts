import type { LogSyncResult } from '@reforger-panel/shared';
import { sanitizeErrorMessage, type Logger } from '../../../lib/logger.js';
import { parseLogChunk } from '../parser/parser.js';
import type { ParsedLogEvent } from '../parser/types.js';
import { computeFingerprint, hashLine, planIngestion } from './cursor-service.js';
import { dateFromLogPath } from './log-path-resolver.js';
import type { CursorRecord, IngestionStore, LogSource, PlayerRecord } from './types.js';

export type IngestionOptions = {
  maxDownloadBytes: number;
};

export type SyncStats = LogSyncResult & {
  ignoredLines: number;
  invalidTimestamps: number;
  reason: string;
};

/**
 * Turns raw Reforger log content into player/session/event records.
 * Orchestrates: fetch (LogSource) → plan (cursor-service) → parse (parser) →
 * persist (IngestionStore). Holds no state between runs beyond the cursor.
 */
export class LogIngestionService {
  constructor(
    private readonly source: LogSource,
    private readonly store: IngestionStore,
    private readonly logger: Logger,
    private readonly options: IngestionOptions,
  ) {}

  async sync(serverId: string, providerServerId: string, logPath: string): Promise<SyncStats> {
    const startedAt = new Date();
    try {
      const stats = await this.runSync(serverId, providerServerId, logPath, startedAt);
      this.logger.debug({ ...stats }, 'log sync completed');
      return stats;
    } catch (error) {
      const message = sanitizeErrorMessage(error);
      await this.recordFailure(serverId, logPath, message).catch(() => undefined);
      this.logger.warn({ serverId, logPath, error: message }, 'log sync failed');
      throw error;
    }
  }

  private async runSync(
    serverId: string,
    providerServerId: string,
    logPath: string,
    startedAt: Date,
  ): Promise<SyncStats> {
    const file = await this.source.fetchLog(
      providerServerId,
      logPath,
      this.options.maxDownloadBytes,
    );
    const buffer = Buffer.from(file.content, 'utf8');
    const snapshot = {
      buffer,
      contentStartOffset: file.contentStartOffset,
      totalSizeBytes: file.totalSizeBytes,
    };

    const cursor = await this.store.getCursor(serverId, logPath);
    const plan = planIngestion(cursor, snapshot);

    // Continuation chunks have no "Log started" header, so carry the calendar
    // date forward from the last ingested event — or, failing that, from the
    // dated per-boot folder name in the log path. A header in the chunk
    // (fresh file after rotation) still overrides this.
    const previousTimestamp =
      (!plan.cursorReset ? (cursor?.lastEventTimestamp ?? null) : null) ?? dateFromLogPath(logPath);
    const parsed = parseLogChunk(plan.chunk, {
      fallbackDate: new Date(),
      context: previousTimestamp
        ? {
            baseDate: new Date(
              Date.UTC(
                previousTimestamp.getUTCFullYear(),
                previousTimestamp.getUTCMonth(),
                previousTimestamp.getUTCDate(),
              ),
            ),
            lastTimestamp: previousTimestamp,
          }
        : undefined,
    });

    let createdEvents = 0;
    let updatedSessions = 0;
    for (const event of parsed.events) {
      const result = await this.applyEvent(serverId, logPath, event);
      createdEvents += result.createdEvents;
      updatedSessions += result.updatedSessions;
    }

    const lastEvent = parsed.events.at(-1);
    const fingerprint =
      computeFingerprint(snapshot) ?? (plan.cursorReset ? null : (cursor?.fileFingerprint ?? null));
    const nextCursor: CursorRecord = {
      serverId,
      logPath,
      fileFingerprint: fingerprint,
      lastByteOffset: plan.nextByteOffset,
      lastLineHash: parsed.lastCompleteLine
        ? hashLine(parsed.lastCompleteLine)
        : plan.cursorReset || plan.reason === 'first_sync'
          ? null
          : (cursor?.lastLineHash ?? null),
      partialTrailingLine:
        parsed.partialTrailingLine ??
        (plan.reason === 'no_new_data' ? (cursor?.partialTrailingLine ?? null) : null),
      lastEventTimestamp: lastEvent?.occurredAt ?? cursor?.lastEventTimestamp ?? null,
      lastSuccessfulSyncAt: new Date(),
      lastErrorAt: null,
      lastErrorMessage: null,
    };
    await this.store.saveCursor(nextCursor);

    return {
      serverId,
      logPath,
      fetchedBytes: buffer.byteLength,
      processedLines: parsed.completeLineCount,
      createdEvents,
      updatedSessions,
      cursorReset: plan.cursorReset,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      ignoredLines: parsed.ignoredLineCount,
      invalidTimestamps: parsed.invalidTimestampCount,
      reason: plan.reason,
    };
  }

  private async recordFailure(serverId: string, logPath: string, message: string): Promise<void> {
    const cursor = await this.store.getCursor(serverId, logPath);
    await this.store.saveCursor({
      serverId,
      logPath,
      fileFingerprint: cursor?.fileFingerprint ?? null,
      lastByteOffset: cursor?.lastByteOffset ?? 0,
      lastLineHash: cursor?.lastLineHash ?? null,
      partialTrailingLine: cursor?.partialTrailingLine ?? null,
      lastEventTimestamp: cursor?.lastEventTimestamp ?? null,
      lastSuccessfulSyncAt: cursor?.lastSuccessfulSyncAt ?? null,
      lastErrorAt: new Date(),
      lastErrorMessage: message,
    });
  }

  private async resolvePlayer(
    serverId: string,
    event: Extract<
      ParsedLogEvent,
      { type: 'player_connected' | 'player_disconnected' | 'player_identity' }
    >,
  ): Promise<PlayerRecord> {
    // Prefer the stable log-provided identity; fall back to display name.
    // Names are NOT globally unique — see README for the limitations.
    if (event.type === 'player_identity' || event.externalPlayerId) {
      const externalId = event.externalPlayerId!;
      const byExternal = await this.store.findPlayerByExternalId(serverId, externalId);
      if (byExternal) {
        if (byExternal.displayName !== event.playerName) {
          await this.store.updatePlayer(byExternal.id, {
            displayName: event.playerName,
            lastSeenAt: event.occurredAt,
          });
        }
        return byExternal;
      }
      const byName = await this.store.findPlayerByName(serverId, event.playerName);
      if (byName && byName.externalPlayerId === null) {
        await this.store.updatePlayer(byName.id, {
          externalPlayerId: externalId,
          lastSeenAt: event.occurredAt,
        });
        return { ...byName, externalPlayerId: externalId };
      }
      if (byName) {
        // The player already carries a different identity (e.g. engine
        // identityId vs BattlEye GUID — the logs emit both). Keep the first
        // one rather than splitting the player into duplicates.
        await this.store.updatePlayer(byName.id, { lastSeenAt: event.occurredAt });
        return byName;
      }
      return this.store.createPlayer({
        serverId,
        displayName: event.playerName,
        externalPlayerId: externalId,
        seenAt: event.occurredAt,
      });
    }

    const byName = await this.store.findPlayerByName(serverId, event.playerName);
    if (byName) {
      await this.store.updatePlayer(byName.id, { lastSeenAt: event.occurredAt });
      return byName;
    }
    return this.store.createPlayer({
      serverId,
      displayName: event.playerName,
      externalPlayerId: null,
      seenAt: event.occurredAt,
    });
  }

  private async resolvePlayerByName(
    serverId: string,
    playerName: string,
    occurredAt: Date,
  ): Promise<PlayerRecord> {
    const byName = await this.store.findPlayerByName(serverId, playerName);
    if (byName) {
      await this.store.updatePlayer(byName.id, { lastSeenAt: occurredAt });
      return byName;
    }
    return this.store.createPlayer({
      serverId,
      displayName: playerName,
      externalPlayerId: null,
      seenAt: occurredAt,
    });
  }

  private async applyEvent(
    serverId: string,
    logPath: string,
    event: ParsedLogEvent,
  ): Promise<{ createdEvents: number; updatedSessions: number }> {
    const lineHash = hashLine(event.rawLine);

    switch (event.type) {
      case 'player_connected': {
        const player = await this.resolvePlayer(serverId, event);
        const inserted = await this.store.insertEventIfNew({
          serverId,
          eventType: 'player_connected',
          occurredAt: event.occurredAt,
          playerId: player.id,
          summary: `${event.playerName} connected`,
          payload: { playerName: event.playerName, playerNumber: event.playerNumber ?? null },
          sourceLogPath: logPath,
          sourceLineHash: lineHash,
        });
        if (!inserted.created) return { createdEvents: 0, updatedSessions: 0 };

        // A connect while a session is open means we missed the disconnect.
        const existing = await this.store.getOpenSession(serverId, player.id);
        let updatedSessions = 0;
        if (existing) {
          await this.store.closeSession(existing.id, {
            disconnectedAt: event.occurredAt,
            durationSeconds: Math.max(
              0,
              Math.round((event.occurredAt.getTime() - existing.connectedAt.getTime()) / 1000),
            ),
            disconnectReason: 'missed_disconnect',
          });
          updatedSessions += 1;
        }
        await this.store.openSession({
          serverId,
          playerId: player.id,
          connectedAt: event.occurredAt,
          sourceLogPath: logPath,
        });
        return { createdEvents: 1, updatedSessions: updatedSessions + 1 };
      }

      case 'player_identity': {
        // Identity lines only enrich the player record; they are not events.
        await this.resolvePlayer(serverId, event);
        return { createdEvents: 0, updatedSessions: 0 };
      }

      case 'player_disconnected': {
        const player = await this.resolvePlayer(serverId, event);
        const inserted = await this.store.insertEventIfNew({
          serverId,
          eventType: 'player_disconnected',
          occurredAt: event.occurredAt,
          playerId: player.id,
          summary: event.reason
            ? `${event.playerName} disconnected (${event.reason})`
            : `${event.playerName} disconnected`,
          payload: { playerName: event.playerName, reason: event.reason ?? null },
          sourceLogPath: logPath,
          sourceLineHash: lineHash,
        });
        if (!inserted.created) return { createdEvents: 0, updatedSessions: 0 };

        const open = await this.store.getOpenSession(serverId, player.id);
        if (!open) return { createdEvents: 1, updatedSessions: 0 };
        await this.store.closeSession(open.id, {
          disconnectedAt: event.occurredAt,
          durationSeconds: Math.max(
            0,
            Math.round((event.occurredAt.getTime() - open.connectedAt.getTime()) / 1000),
          ),
          disconnectReason: event.reason ?? null,
        });
        return { createdEvents: 1, updatedSessions: 1 };
      }

      case 'player_killed': {
        const killer = await this.resolvePlayerByName(serverId, event.killerName, event.occurredAt);
        const victim = await this.resolvePlayerByName(serverId, event.victimName, event.occurredAt);
        const inserted = await this.store.insertEventIfNew({
          serverId,
          eventType: 'player_killed',
          occurredAt: event.occurredAt,
          playerId: victim.id,
          summary: `${event.killerName} killed ${event.victimName}`,
          payload: {
            killerPlayerId: killer.id,
            killerName: event.killerName,
            victimPlayerId: victim.id,
            victimName: event.victimName,
            friendly: event.friendly,
            killerTeam: null,
            victimTeam: null,
            killerPosition: null,
            victimPosition: null,
            distanceMeters: null,
            weapon: null,
          },
          sourceLogPath: logPath,
          sourceLineHash: lineHash,
        });
        return { createdEvents: inserted.created ? 1 : 0, updatedSessions: 0 };
      }

      case 'server_started': {
        const inserted = await this.store.insertEventIfNew({
          serverId,
          eventType: 'server_started',
          occurredAt: event.occurredAt,
          summary: 'Server started',
          payload: {},
          sourceLogPath: logPath,
          sourceLineHash: lineHash,
        });
        if (!inserted.created) return { createdEvents: 0, updatedSessions: 0 };

        // Sessions can't survive a server start; anything still open was
        // orphaned by a crash/restart we didn't see a disconnect for.
        const { closed } = await this.store.closeAllOpenSessions(
          serverId,
          event.occurredAt,
          'server_restart',
        );
        let createdEvents = 1;
        if (closed > 0) {
          const restartInserted = await this.store.insertEventIfNew({
            serverId,
            eventType: 'server_restart_detected',
            occurredAt: event.occurredAt,
            summary: `Server restart detected (${closed} session${closed === 1 ? '' : 's'} closed)`,
            payload: { closedSessions: closed },
            sourceLogPath: logPath,
            sourceLineHash: `${lineHash}:restart`,
          });
          if (restartInserted.created) createdEvents += 1;
        }
        return { createdEvents, updatedSessions: closed };
      }
    }
  }
}
