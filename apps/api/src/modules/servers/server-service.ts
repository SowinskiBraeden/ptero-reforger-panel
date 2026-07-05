import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type {
  ActivityItem,
  KillfeedEvent,
  KnownPlayer,
  ModPackSummary,
  OnlinePlayer,
  PlayersResponse,
} from '@reforger-panel/shared';
import type { Db } from '../../db/client.js';
import { schema } from '../../db/client.js';

export type ServerRecord = typeof schema.servers.$inferSelect;

export class ServerService {
  constructor(private readonly db: Db) {}

  async listServers(): Promise<ServerRecord[]> {
    return this.db.select().from(schema.servers).orderBy(schema.servers.name);
  }

  async getServerBySlug(slug: string): Promise<ServerRecord | null> {
    const rows = await this.db.select().from(schema.servers).where(eq(schema.servers.slug, slug));
    return rows[0] ?? null;
  }

  async updateStatus(serverId: string, status: string): Promise<void> {
    await this.db.update(schema.servers).set({ status }).where(eq(schema.servers.id, serverId));
  }

  async updateServerInfo(
    serverId: string,
    patch: { name?: string; maxPlayers?: number | null },
  ): Promise<void> {
    await this.db.update(schema.servers).set(patch).where(eq(schema.servers.id, serverId));
  }

  async countOnlinePlayers(serverId: string): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(schema.playerSessions)
      .where(
        and(
          eq(schema.playerSessions.serverId, serverId),
          isNull(schema.playerSessions.disconnectedAt),
        ),
      );
    return rows[0]?.value ?? 0;
  }

  async getOnlinePlayers(
    server: ServerRecord,
    staleAfterSeconds: number,
  ): Promise<PlayersResponse> {
    const rows = await this.db
      .select({ session: schema.playerSessions, player: schema.players })
      .from(schema.playerSessions)
      .innerJoin(schema.players, eq(schema.players.id, schema.playerSessions.playerId))
      .where(
        and(
          eq(schema.playerSessions.serverId, server.id),
          isNull(schema.playerSessions.disconnectedAt),
        ),
      )
      .orderBy(schema.playerSessions.connectedAt);

    const now = Date.now();
    const players: OnlinePlayer[] = rows.map(({ session, player }) => ({
      playerId: player.id,
      displayName: player.displayName,
      externalPlayerId: player.externalPlayerId,
      connectedAt: session.connectedAt.toISOString(),
      sessionDurationSeconds: Math.max(0, Math.round((now - session.connectedAt.getTime()) / 1000)),
    }));

    const cursors = await this.db
      .select()
      .from(schema.logCursors)
      .where(eq(schema.logCursors.serverId, server.id));
    const lastSyncedAt = cursors
      .map((c) => c.lastSuccessfulSyncAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      players,
      onlineCount: players.length,
      maxPlayers: server.maxPlayers,
      lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
      stale: !lastSyncedAt || now - lastSyncedAt.getTime() > staleAfterSeconds * 1000,
    };
  }

  async getKnownPlayers(serverId: string, limit = 100): Promise<KnownPlayer[]> {
    const rows = await this.db
      .select({
        player: schema.players,
        totalSessions: count(schema.playerSessions.id),
        totalPlaytimeSeconds: sql<number>`coalesce(sum(${schema.playerSessions.durationSeconds}), 0)`,
        openSessions: sql<number>`count(*) filter (where ${schema.playerSessions.disconnectedAt} is null)`,
      })
      .from(schema.players)
      .leftJoin(schema.playerSessions, eq(schema.playerSessions.playerId, schema.players.id))
      .where(eq(schema.players.serverId, serverId))
      .groupBy(schema.players.id)
      .orderBy(desc(schema.players.lastSeenAt))
      .limit(limit);

    return rows.map(({ player, totalSessions, totalPlaytimeSeconds, openSessions }) => ({
      id: player.id,
      displayName: player.displayName,
      externalPlayerId: player.externalPlayerId,
      firstSeenAt: player.firstSeenAt.toISOString(),
      lastSeenAt: player.lastSeenAt.toISOString(),
      totalSessions,
      totalPlaytimeSeconds: Number(totalPlaytimeSeconds),
      online: Number(openSessions) > 0,
    }));
  }

  /** Merged feed of panel actions (server_activity) and log-derived server events. */
  async getActivity(serverId: string, limit = 50): Promise<ActivityItem[]> {
    const actions = await this.db
      .select({ activity: schema.serverActivity, actor: schema.users })
      .from(schema.serverActivity)
      .leftJoin(schema.users, eq(schema.users.id, schema.serverActivity.actorUserId))
      .where(eq(schema.serverActivity.serverId, serverId))
      .orderBy(desc(schema.serverActivity.createdAt))
      .limit(limit);

    const events = await this.db
      .select()
      .from(schema.serverEvents)
      .where(eq(schema.serverEvents.serverId, serverId))
      .orderBy(desc(schema.serverEvents.occurredAt))
      .limit(limit);

    const items: ActivityItem[] = [
      ...actions.map(({ activity, actor }) => ({
        id: `activity:${activity.id}`,
        kind: 'panel_action' as const,
        action: activity.action,
        summary: activity.summary,
        actor: actor
          ? { id: actor.id, username: actor.username, displayName: actor.displayName }
          : null,
        occurredAt: activity.createdAt.toISOString(),
      })),
      ...events.map((event) => ({
        id: `event:${event.id}`,
        kind: 'server_event' as const,
        action: event.eventType,
        summary: event.summary,
        actor: null,
        occurredAt: event.occurredAt.toISOString(),
      })),
    ];
    items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return items.slice(0, limit);
  }

  async getKillfeed(serverId: string, limit = 100): Promise<KillfeedEvent[]> {
    const events = await this.db
      .select()
      .from(schema.serverEvents)
      .where(
        and(
          eq(schema.serverEvents.serverId, serverId),
          eq(schema.serverEvents.eventType, 'player_killed'),
        ),
      )
      .orderBy(desc(schema.serverEvents.occurredAt))
      .limit(limit);

    return events.map((event) => {
      const payload = event.payload as Record<string, unknown>;
      const position = (value: unknown) => {
        if (!value || typeof value !== 'object') return null;
        const record = value as Record<string, unknown>;
        return typeof record.x === 'number' && typeof record.y === 'number'
          ? {
              x: record.x,
              y: record.y,
              z: typeof record.z === 'number' ? record.z : null,
            }
          : null;
      };
      return {
        id: event.id,
        occurredAt: event.occurredAt.toISOString(),
        killerName: typeof payload.killerName === 'string' ? payload.killerName : 'unknown',
        victimName: typeof payload.victimName === 'string' ? payload.victimName : 'unknown',
        friendly: payload.friendly === true,
        killerTeam: typeof payload.killerTeam === 'string' ? payload.killerTeam : null,
        victimTeam: typeof payload.victimTeam === 'string' ? payload.victimTeam : null,
        killerPosition: position(payload.killerPosition),
        victimPosition: position(payload.victimPosition),
        distanceMeters: typeof payload.distanceMeters === 'number' ? payload.distanceMeters : null,
        weapon: typeof payload.weapon === 'string' ? payload.weapon : null,
      };
    });
  }

  async recordActivity(input: {
    serverId: string;
    actorUserId: string | null;
    action: string;
    summary: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(schema.serverActivity).values({
      serverId: input.serverId,
      actorUserId: input.actorUserId,
      action: input.action,
      summary: input.summary,
      metadata: input.metadata ?? {},
    });
  }

  async getModPacks(serverId: string): Promise<ModPackSummary[]> {
    const packs = await this.db
      .select()
      .from(schema.modPacks)
      .where(eq(schema.modPacks.serverId, serverId))
      .orderBy(desc(schema.modPacks.updatedAt));

    const result: ModPackSummary[] = [];
    for (const pack of packs) {
      const revisions = await this.db
        .select()
        .from(schema.modPackRevisions)
        .where(eq(schema.modPackRevisions.modPackId, pack.id))
        .orderBy(desc(schema.modPackRevisions.version))
        .limit(1);
      const latest = revisions[0];
      const mods = (latest?.mods ?? []) as unknown[];
      result.push({
        id: pack.id,
        name: pack.name,
        description: pack.description,
        status: pack.status,
        modCount: Array.isArray(mods) ? mods.length : 0,
        latestVersion: latest?.version ?? null,
        updatedAt: pack.updatedAt.toISOString(),
      });
    }
    return result;
  }

  async getLogCursor(serverId: string) {
    const rows = await this.db
      .select()
      .from(schema.logCursors)
      .where(eq(schema.logCursors.serverId, serverId))
      .orderBy(desc(schema.logCursors.updatedAt))
      .limit(1);
    return rows[0] ?? null;
  }
}
