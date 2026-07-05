import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID());

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date());

export const users = pgTable(
  'users',
  {
    id: id(),
    discordId: text('discord_id').notNull(),
    username: text('username').notNull(),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    role: text('role', { enum: ['owner', 'server_admin', 'mission_lead', 'viewer'] })
      .notNull()
      .default('viewer'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_discord_id_unique').on(t.discordId)],
);

export const sessions = pgTable(
  'sessions',
  {
    // sha256 hash of the cookie token; the raw token is never stored.
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const invites = pgTable(
  'invites',
  {
    id: id(),
    code: text('code').notNull(),
    role: text('role', { enum: ['owner', 'server_admin', 'mission_lead', 'viewer'] })
      .notNull()
      .default('viewer'),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedByUserId: text('used_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('invites_code_unique').on(t.code)],
);

export const servers = pgTable(
  'servers',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    providerType: text('provider_type').notNull().default('pterodactyl'),
    pterodactylServerId: text('pterodactyl_server_id'),
    status: text('status').notNull().default('unknown'),
    maxPlayers: integer('max_players'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('servers_slug_unique').on(t.slug)],
);

export const serverActivity = pgTable(
  'server_activity',
  {
    id: id(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    summary: text('summary').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('server_activity_server_created_idx').on(t.serverId, t.createdAt)],
);

export const modPacks = pgTable('mod_packs', {
  id: id(),
  serverId: text('server_id')
    .notNull()
    .references(() => servers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('draft'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const modPackRevisions = pgTable(
  'mod_pack_revisions',
  {
    id: id(),
    modPackId: text('mod_pack_id')
      .notNull()
      .references(() => modPacks.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    notes: text('notes'),
    mods: jsonb('mods').notNull().default([]),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('mod_pack_revisions_pack_version_unique').on(t.modPackId, t.version)],
);

export const configRevisions = pgTable(
  'config_revisions',
  {
    id: id(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    version: integer('version').notNull(),
    summary: text('summary').notNull(),
    config: jsonb('config').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('config_revisions_server_version_unique').on(t.serverId, t.version)],
);

export const logCursors = pgTable(
  'log_cursors',
  {
    id: id(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    logPath: text('log_path').notNull(),
    fileFingerprint: text('file_fingerprint'),
    lastByteOffset: bigint('last_byte_offset', { mode: 'number' }).notNull().default(0),
    lastLineHash: text('last_line_hash'),
    partialTrailingLine: text('partial_trailing_line'),
    lastEventTimestamp: timestamp('last_event_timestamp', { withTimezone: true }),
    lastSuccessfulSyncAt: timestamp('last_successful_sync_at', { withTimezone: true }),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    lastErrorMessage: text('last_error_message'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('log_cursors_server_path_unique').on(t.serverId, t.logPath)],
);

export const players = pgTable(
  'players',
  {
    id: id(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    // Stable identity from logs (e.g. a GUID) when available. Display names are
    // NOT unique identities; see README for the fallback limitations.
    externalPlayerId: text('external_player_id'),
    displayName: text('display_name').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('players_server_external_id_unique').on(t.serverId, t.externalPlayerId),
    index('players_server_name_idx').on(t.serverId, t.displayName),
  ],
);

export const playerSessions = pgTable(
  'player_sessions',
  {
    id: id(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull(),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
    durationSeconds: integer('duration_seconds'),
    disconnectReason: text('disconnect_reason'),
    sourceLogPath: text('source_log_path').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('player_sessions_server_open_idx').on(t.serverId, t.disconnectedAt),
    index('player_sessions_player_idx').on(t.playerId),
  ],
);

export const serverEvents = pgTable(
  'server_events',
  {
    id: id(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    playerId: text('player_id').references(() => players.id, { onDelete: 'set null' }),
    playerSessionId: text('player_session_id').references(() => playerSessions.id, {
      onDelete: 'set null',
    }),
    summary: text('summary').notNull(),
    payload: jsonb('payload').notNull().default({}),
    sourceLogPath: text('source_log_path').notNull(),
    sourceLineHash: text('source_line_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // Event deduplication key: one event per (server, log file, line fingerprint).
    uniqueIndex('server_events_dedupe_unique').on(t.serverId, t.sourceLogPath, t.sourceLineHash),
    index('server_events_server_occurred_idx').on(t.serverId, t.occurredAt),
  ],
);
