import type { Capability, Role } from './roles.js';
import type { ReforgerConfigMod, ReforgerServerConfig } from './reforger-config.js';

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
  /**
   * Where the numbers came from. 'live' means a Wings `stats` frame pushed
   * within the last few seconds; 'poll' means the slower REST fallback.
   */
  source: 'live' | 'poll';
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
  revision: string;
  fetchedAt: string;
};

export type ConfigValueType = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';

/** One leaf of config.json, addressed by dotted path (e.g. `game.maxPlayers`). */
export type ConfigEntry = {
  path: string;
  value: string | number | boolean | null;
  type: ConfigValueType;
  /** JSON text for values the flat editor cannot represent inline. */
  raw?: string;
};

/**
 * A config.json key that some Reforger eggs re-template from a Pterodactyl
 * startup variable at boot. Editing the file alone would be silently undone.
 */
export type StartupMirror = {
  envVariable: string;
  configPath: string;
  startupValue: string;
  configValue: string | number | boolean | null;
  /** True when the two currently disagree. */
  conflict: boolean;
};

export type ConfigTreeResponse = {
  entries: ConfigEntry[];
  mirrors: StartupMirror[];
  revision: string;
  fetchedAt: string;
};

/** `value: null` removes the key so the game default applies. */
export type ConfigPatchOp = {
  path: string;
  value: string | number | boolean | null;
};

export type ConfigPatchRequest = {
  ops: ConfigPatchOp[];
  /** Revision the edits were based on; a mismatch is rejected as a conflict. */
  expectedRevision?: string;
  /** Also mirror changed values into their matching startup variables. */
  writeStartupVars?: boolean;
};

export type ConfigPatchResult = {
  changedPaths: string[];
  startupVarsWritten: string[];
  revision: string;
  fetchedAt: string;
  requiresRestart: true;
};

export type ConfigRawResponse = {
  content: string;
  revision: string;
  fetchedAt: string;
};

// ---------- Missions ----------

export type MissionInfo = {
  scenarioId: string;
  /** Display name, e.g. "Conflict - Everon". */
  name: string;
  gameMode: string | null;
  playerCount: number | null;
};

export type MissionGroup = {
  /** 'official', or the workshop mod id that ships these scenarios. */
  id: string;
  label: string;
  kind: 'official' | 'mod';
  missions: MissionInfo[];
};

export type MissionsResponse = {
  groups: MissionGroup[];
  /** Installed mods whose scenario list could not be resolved this time. */
  incompleteModIds: string[];
  fetchedAt: string | null;
};

// ---------- Logs ----------

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

// ---------- Live console (Pterodactyl / Wings) ----------

export type ConsoleLineStream = 'console' | 'install' | 'daemon';

export type ConsoleLine = {
  /** Monotonic per-connection sequence number, for de-duplication. */
  seq: number;
  stream: ConsoleLineStream;
  text: string;
  at: number;
};

export type ConsoleBacklog = {
  lines: ConsoleLine[];
  status: ServerStatus;
  connected: boolean;
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
  diskBytes: number;
  diskLimitBytes: number | null;
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
  disableAI: boolean | null; // operating (default false)
  aiLimit: number | null; // operating, -1 = unlimited (default -1)
  playerSaveTime: number | null; // operating, seconds (default 120)
  slotReservationTimeout: number | null; // operating, 5–300 s (default 60)
  lobbyPlayerSynchronise: boolean | null; // operating (default true)
};

export type PerformanceSettingsResponse = {
  settings: PerformanceSettings;
  revision: string;
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
  mods: ReforgerConfigMod[];
  /** sha256 of the config.json this list came from; required to write it back. */
  revision: string;
  fetchedAt: string;
};

/** Workshop metadata attached to an installed mod. Null when unresolvable. */
export type ModWorkshopInfo = {
  name: string;
  author: string;
  summary: string | null;
  imageUrl: string | null;
  workshopUrl: string | null;
  latestVersion: string | null;
  gameVersion: string | null;
  sizeBytes: number | null;
  scenarioCount: number;
  dependencyCount: number;
  obsolete: boolean;
  tags: string[];
};

export type ModOverviewEntry = {
  modId: string;
  /** Name recorded in config.json, if any. */
  configName: string | null;
  /** Version pinned in config.json; null means "track latest". */
  pinnedVersion: string | null;
  workshop: ModWorkshopInfo | null;
  updateAvailable: boolean;
  /** Dependencies of this mod that are missing from the server's list. */
  missingDependencies: WorkshopDependency[];
  /** Ids of installed mods that depend on this one — blockers for removal. */
  requiredBy: string[];
};

export type ModsOverviewResponse = {
  mods: ModOverviewEntry[];
  revision: string;
  fetchedAt: string;
  totalSizeBytes: number | null;
  updatesAvailable: number;
  /** Mod ids the Workshop could not resolve (private, delisted, or upstream down). */
  unresolvedIds: string[];
  /** True while lookups are still warming; refetch shortly for complete data. */
  warming: boolean;
  /** Set when config.json's scenarioId is not offered by anything installed. */
  orphanedMission: { scenarioId: string } | null;
};

export type ResolvedMod = {
  modId: string;
  name: string | null;
  version: string | null;
  sizeBytes: number | null;
  /** True when pulled in as a dependency rather than explicitly requested. */
  viaDependency: boolean;
  /** Requested mods that require this one. */
  requiredBy: string[];
};

export type ModResolveResponse = {
  /** The requested list plus every dependency needed to make it load. */
  mods: ResolvedMod[];
  /** The subset that had to be added to satisfy dependencies. */
  addedDependencies: ResolvedMod[];
  totalSizeBytes: number | null;
  unresolvedIds: string[];
};

export type UpdateModsResult = ServerModsResponse & {
  added: number;
  removed: number;
  changed: number;
  /** Reforger only picks up config changes on the next server restart. */
  requiresRestart: true;
};

// ---------- Workshop (reforgermods.net v2) ----------

export const WORKSHOP_SORTS = [
  'popularity',
  'most-rated',
  'highest-rated',
  'subscribers',
  'newest',
  'created',
  'recently-updated',
  'largest',
  'name',
] as const;

export type WorkshopSort = (typeof WORKSHOP_SORTS)[number];

export type WorkshopModPreview = {
  id: string;
  name: string;
  author: string;
  summary: string | null;
  imageUrl: string | null;
  workshopUrl: string | null;
  version: string | null;
  gameVersion: string | null;
  sizeBytes: number | null;
  sizeText: string | null;
  /** 0–1. */
  rating: number | null;
  ratingCount: number | null;
  subscriberCount: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  tags: string[];
  obsolete: boolean;
};

export type WorkshopSearchResponse = {
  mods: WorkshopModPreview[];
  meta: {
    totalPages: number;
    currentPage: number;
    totalMods: number;
  };
};

export type WorkshopDependency = {
  id: string;
  name: string;
  version: string | null;
  sizeBytes: number | null;
  published: boolean;
  private: boolean;
};

export type WorkshopScenario = {
  /** The `{HEX16}Missions/....conf` id used by game.scenarioId. */
  scenarioId: string;
  name: string;
  gameMode: string | null;
  author: string | null;
  description: string | null;
  playerCount: number | null;
};

export type WorkshopModDetail = WorkshopModPreview & {
  description: string | null;
  license: string | null;
  downloadCount: number | null;
  previewImages: string[];
  screenshots: string[];
  versionCount: number | null;
  dependencyCount: number;
  scenarioCount: number;
  dependencySizeBytes: number | null;
  totalSizeBytes: number | null;
  dependencies: WorkshopDependency[];
  scenarios: WorkshopScenario[];
};

export type WorkshopModVersion = {
  version: string;
  gameVersion: string | null;
  sizeBytes: number | null;
  sizeText: string | null;
  approved: boolean;
  published: boolean;
  createdAt: string | null;
  scenarioCount: number | null;
  dependencyCount: number | null;
};

export type WorkshopModVersionsResponse = {
  modId: string;
  versions: WorkshopModVersion[];
};

/** A live Arma Reforger server from the reforgermods.net server browser. */
export type WorkshopServerSummary = {
  id: string;
  name: string;
  scenarioId: string | null;
  scenarioName: string | null;
  gameVersion: string | null;
  players: number;
  maxPlayers: number;
  region: string | null;
  platform: string | null;
  modCount: number;
  official: boolean;
  online: boolean;
};

export type WorkshopServerSearchResponse = {
  servers: WorkshopServerSummary[];
  meta: {
    totalPages: number;
    currentPage: number;
    totalServers: number;
  };
};

export type WorkshopServerMod = {
  id: string;
  name: string;
  version: string | null;
  sizeBytes: number | null;
};

export type WorkshopServerModsResponse = {
  serverId: string;
  mods: WorkshopServerMod[];
  knownSizeBytes: number | null;
  unresolvedCount: number;
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
