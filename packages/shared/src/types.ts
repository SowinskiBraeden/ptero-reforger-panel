import type { Capability, Role } from './roles.js';
import type { ReforgerServerConfig } from './reforger-config.js';

// ---------- API envelope ----------

export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'UPSTREAM_UNAVAILABLE'
  | 'NOT_CONFIGURED'
  | 'INTERNAL_ERROR';

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId?: string;
  };
};

// ---------- Auth / users ----------

export type CurrentUser = {
  id: string;
  discordId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: Role;
  capabilities: Capability[];
};

export type PanelUser = {
  id: string;
  discordId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: Role;
  createdAt: string;
  updatedAt: string;
};

// ---------- Servers ----------

export type ServerStatus = 'online' | 'offline' | 'starting' | 'stopping' | 'unknown';

export type ServerSummary = {
  id: string;
  slug: string;
  name: string;
  providerType: string;
  status: ServerStatus;
  maxPlayers: number | null;
  onlinePlayerCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ServerResources = {
  status: ServerStatus;
  cpuPercent: number;
  cpuLimitPercent: number | null;
  memoryBytes: number;
  memoryLimitBytes: number | null;
  diskBytes: number;
  diskLimitBytes: number | null;
  networkRxBytes: number;
  networkTxBytes: number;
  uptimeMs: number;
  fetchedAt: string;
};

// ---------- Players ----------

export type OnlinePlayer = {
  playerId: string;
  displayName: string;
  externalPlayerId: string | null;
  connectedAt: string;
  sessionDurationSeconds: number;
};

export type PlayersResponse = {
  players: OnlinePlayer[];
  onlineCount: number;
  maxPlayers: number | null;
  lastSyncedAt: string | null;
  stale: boolean;
};

export type KnownPlayer = {
  id: string;
  displayName: string;
  externalPlayerId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  totalSessions: number;
  totalPlaytimeSeconds: number;
  online: boolean;
};

// ---------- Activity ----------

export type ActivityItem = {
  id: string;
  kind: 'panel_action' | 'server_event';
  action: string;
  summary: string;
  actor: { id: string; username: string; displayName: string | null } | null;
  occurredAt: string;
};

export type PlayerPosition = {
  x: number;
  y: number;
  z?: number | null;
};

export type KillfeedEvent = {
  id: string;
  occurredAt: string;
  killerName: string;
  victimName: string;
  friendly: boolean;
  killerTeam: string | null;
  victimTeam: string | null;
  killerPosition: PlayerPosition | null;
  victimPosition: PlayerPosition | null;
  distanceMeters: number | null;
  weapon: string | null;
};

// ---------- Configuration ----------

/** The live config.json, downloaded from the server on request. */
export type ConfigurationResponse = {
  config: ReforgerServerConfig;
  fetchedAt: string;
};

export type MissionInfo = {
  scenarioId: string;
  /** Display name from the startup scenario listing, e.g. "Conflict - Everon". */
  name: string;
  /** 'official' or the source section header from the log. */
  source: string;
};

export type MissionsResponse = {
  missions: MissionInfo[];
  /** Null when the current log contains no scenario listing. */
  fetchedAt: string | null;
};

export type RawLogsResponse = {
  path: string;
  lines: string[];
  truncated: boolean;
  fetchedAt: string;
};

export type StartupVariable = {
  name: string;
  description: string;
  envVariable: string;
  value: string;
  defaultValue: string;
  isEditable: boolean;
};

export type StartupResponse = {
  variables: StartupVariable[];
  fetchedAt: string;
};

// ---------- Schedules ----------

export type ServerScheduleTask = {
  id: string;
  action: 'power' | 'command' | 'backup' | string;
  payload: string;
  timeOffsetSeconds: number;
  continueOnFailure: boolean;
};

export type ServerScheduleSummary = {
  id: string;
  name: string;
  isActive: boolean;
  onlyWhenOnline: boolean;
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  tasks: ServerScheduleTask[];
};

export type RestartScheduleInput = {
  name: string;
  isActive: boolean;
  minute: number;
  hour: number;
  dayOfWeek: '*' | '0' | '1' | '2' | '3' | '4' | '5' | '6';
  onlyWhenOnline: boolean;
};

// ---------- Mod packs ----------

export type ModPackSummary = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  modCount: number;
  latestVersion: number | null;
  updatedAt: string;
};

// ---------- Resource history ----------

export type ResourceSample = {
  /** Unix ms. */
  t: number;
  status: ServerStatus;
  cpuPercent: number;
  cpuLimitPercent: number | null;
  memoryBytes: number;
  memoryLimitBytes: number | null;
  /** Bytes per second, derived from consecutive cumulative counters. */
  networkRxRate: number;
  networkTxRate: number;
};

export type ResourceHistoryResponse = {
  samples: ResourceSample[];
  intervalSeconds: number;
};

// ---------- Performance settings (subset of config.json) ----------

/**
 * Server-performance fields of Reforger's config.json, per
 * https://community.bistudio.com/wiki/Arma_Reforger:Server_Config.
 * `null` means the key is absent from config.json (game default applies).
 */
export type PerformanceSettings = {
  scenarioId: string | null; // game.scenarioId — the running mission
  maxPlayers: number | null; // game.maxPlayers, 1–128 (default 64)
  serverMaxViewDistance: number | null; // game.gameProperties, 500–10000 (default 1600)
  networkViewDistance: number | null; // game.gameProperties, 500–5000 (default 1500)
  serverMinGrassDistance: number | null; // game.gameProperties, 0–150 (default 0)
  disableThirdPerson: boolean | null; // game.gameProperties (default false)
  fastValidation: boolean | null; // game.gameProperties (default true)
  battlEye: boolean | null; // game.gameProperties (default true)
  aiLimit: number | null; // operating, -1 = unlimited (default -1)
  playerSaveTime: number | null; // operating, seconds (default 120)
  slotReservationTimeout: number | null; // operating, 5–300 s (default 60)
  lobbyPlayerSynchronise: boolean | null; // operating (default true)
};

export type PerformanceSettingsResponse = {
  settings: PerformanceSettings;
  fetchedAt: string;
};

/** PUT body: only the provided keys are touched; null removes the key. */
export type PerformanceSettingsPatch = Partial<PerformanceSettings>;

// ---------- Invites ----------

export type InviteSummary = {
  id: string;
  code: string;
  role: Role;
  createdBy: string | null;
  expiresAt: string;
  usedBy: string | null;
  usedAt: string | null;
  createdAt: string;
};

// ---------- Server mods (game.mods in config.json) ----------

export type ServerModsResponse = {
  mods: { modId: string; name?: string; version?: string }[];
  /** When the config.json this list came from was downloaded. */
  fetchedAt: string;
};

export type UpdateModsResult = ServerModsResponse & {
  added: number;
  removed: number;
  /** Reforger only picks up config changes on the next server restart. */
  requiresRestart: true;
};

// ---------- Workshop ----------

export type WorkshopHealth = {
  ok: boolean;
  latencyMs: number | null;
  checkedAt: string;
  message: string | null;
};

export type WorkshopModPreview = {
  id: string;
  name: string;
  author: string;
  imageUrl: string | null;
  size: string | null;
  rating: string | null;
  workshopUrl: string | null;
};

export type WorkshopSearchResponse = {
  mods: WorkshopModPreview[];
  meta: {
    totalPages: number;
    currentPage: number;
    totalMods: number;
  };
};

export type WorkshopScenario = {
  name: string;
  description: string | null;
  scenarioId: string;
  gamemode: string | null;
  playerCount: number | null;
  imageUrl: string | null;
};

export type WorkshopModDetail = WorkshopModPreview & {
  version: string | null;
  gameVersion: string | null;
  subscribers: number | null;
  downloads: number | null;
  createdAtText: string | null;
  lastModifiedText: string | null;
  summary: string | null;
  description: string | null;
  license: string | null;
  tags: string[];
  dependencies: { name: string; id: string | null }[];
  scenarios: WorkshopScenario[];
};

// ---------- Log ingestion ----------

export type ServerEventType =
  | 'player_connected'
  | 'player_disconnected'
  | 'player_killed'
  | 'server_started'
  | 'server_stopped'
  | 'server_restart_detected'
  | 'log_sync_completed'
  | 'log_sync_failed';

export type LogSyncResult = {
  serverId: string;
  logPath: string;
  fetchedBytes: number;
  processedLines: number;
  createdEvents: number;
  updatedSessions: number;
  cursorReset: boolean;
  startedAt: string;
  finishedAt: string;
};

export type LogIngestionHealth = {
  configured: boolean;
  running: boolean;
  logPath: string | null;
  lastSuccessfulSyncAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  lastSync: {
    processedLines: number;
    createdEvents: number;
    updatedSessions: number;
  } | null;
  stale: boolean;
};
