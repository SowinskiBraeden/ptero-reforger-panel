import { createApp } from './app.js';
import { createDb } from './db/client.js';
import { isPterodactylConfigured, loadEnv } from './env.js';
import { createLogger } from './lib/logger.js';
import { SessionService } from './modules/auth/session-service.js';
import { ConfigEditorService } from './modules/config/config-editor-service.js';
import { ConfigFileGateway } from './modules/config/config-file-gateway.js';
import { ConfigSyncService } from './modules/config/config-sync.js';
import { ServerModsService } from './modules/config/mods-service.js';
import { PerformanceSettingsService } from './modules/config/performance-service.js';
import { ServerMetricsService } from './modules/servers/metrics-service.js';
import { ResourceHistoryService } from './modules/servers/resource-history.js';
import { MissionCatalog, MissionsService } from './modules/reforger-logs/missions-catalog.js';
import type { ConsoleHub } from './modules/pterodactyl/console-hub.js';
import { MockConsoleHub } from './modules/pterodactyl/mock-console-hub.js';
import { MockGameServerProvider } from './modules/pterodactyl/mock-provider.js';
import { PterodactylProvider } from './modules/pterodactyl/pterodactyl-provider.js';
import { WingsConsoleHub } from './modules/pterodactyl/wings-socket.js';
import type { GameServerProvider } from './modules/pterodactyl/types.js';
import { DrizzleIngestionStore } from './modules/reforger-logs/ingestion/drizzle-store.js';
import { LogIngestionService } from './modules/reforger-logs/ingestion/ingestion-service.js';
import { createLogPathResolver } from './modules/reforger-logs/ingestion/log-path-resolver.js';
import { PterodactylLogSource } from './modules/reforger-logs/ingestion/pterodactyl-log-source.js';
import { IngestionScheduler } from './modules/reforger-logs/ingestion/scheduler.js';
import { ServerService } from './modules/servers/server-service.js';
import { WorkshopCache } from './modules/workshop/workshop-cache.js';
import { WorkshopClient } from './modules/workshop/workshop-client.js';

const logger = createLogger();

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL);

const mockLogPath = env.REFORGER_ADMIN_LOG_PATH || '/profile/logs/console.log';
const mockProvider = env.USE_MOCK_PTERODACTYL
  ? new MockGameServerProvider({ logPath: mockLogPath })
  : null;
const provider: GameServerProvider =
  mockProvider ??
  new PterodactylProvider({
    baseUrl: env.PTERODACTYL_BASE_URL,
    apiKey: env.PTERODACTYL_CLIENT_API_KEY,
  });

const sessions = new SessionService(db, env.OWNER_DISCORD_ID);
const servers = new ServerService(db);

const workshop = new WorkshopCache(
  new WorkshopClient({
    baseUrl: env.REFORGER_WORKSHOP_API_BASE_URL,
    apiKey: env.REFORGER_WORKSHOP_API_KEY,
  }),
  logger,
);

const primaryServer = (await servers.listServers())[0] ?? null;
const providerServerId = primaryServer
  ? (primaryServer.pterodactylServerId ?? primaryServer.slug)
  : '';

/**
 * The live console feed. Under mock mode it is simulated; against a real
 * Pterodactyl it is the Wings websocket, which is the only source that shows
 * install/update/mod-download output as it happens.
 */
let consoleHub: ConsoleHub | null = null;
if (mockProvider) {
  consoleHub = new MockConsoleHub(mockProvider);
} else if (isPterodactylConfigured(env) && env.PTERODACTYL_WEBSOCKET_ENABLED && providerServerId) {
  consoleHub = new WingsConsoleHub({
    baseUrl: env.PTERODACTYL_BASE_URL,
    apiKey: env.PTERODACTYL_CLIENT_API_KEY,
    serverId: providerServerId,
    logger,
  });
} else {
  logger.info('live console disabled (websocket off or backend not configured)');
}

const gateway = new ConfigFileGateway(provider, env.REFORGER_CONFIG_PATH);
const configured = isPterodactylConfigured(env);
const configSync = configured ? new ConfigSyncService(gateway, servers, logger) : null;
const configEditor = configSync
  ? new ConfigEditorService(gateway, provider, configSync, logger)
  : null;
const mods = configured ? new ServerModsService(gateway, workshop, logger) : null;
const performance = configEditor
  ? new PerformanceSettingsService(gateway, configEditor, logger)
  : null;

const metrics = new ServerMetricsService(provider, consoleHub);
const resourceHistory = new ResourceHistoryService(metrics, logger);

// Log ingestion runs when a backend is configured and we know where logs live.
// It no longer powers the console view — only player sessions and killfeed,
// which are parsed out of the game's own log file.
const logsConfigured =
  configured &&
  Boolean(env.REFORGER_ADMIN_LOG_PATH || env.REFORGER_LOG_DIRECTORY || env.USE_MOCK_PTERODACTYL);

const resolveLogPath =
  logsConfigured && primaryServer
    ? createLogPathResolver({
        provider,
        providerServerId,
        explicitPath: env.USE_MOCK_PTERODACTYL ? mockLogPath : env.REFORGER_ADMIN_LOG_PATH,
        directory: env.REFORGER_LOG_DIRECTORY,
        fileName: env.REFORGER_LOG_FILE_PATTERN,
      })
    : null;

const missionCatalog =
  resolveLogPath && primaryServer
    ? new MissionCatalog(provider, resolveLogPath, providerServerId)
    : null;
const missions = new MissionsService(workshop, missionCatalog);

let scheduler: IngestionScheduler | null = null;
if (resolveLogPath) {
  const ingestion = new LogIngestionService(
    new PterodactylLogSource(provider),
    new DrizzleIngestionStore(db),
    logger,
    { maxDownloadBytes: env.REFORGER_LOG_MAX_DOWNLOAD_BYTES },
  );
  scheduler = new IngestionScheduler(
    ingestion,
    logger,
    env.REFORGER_LOG_POLL_INTERVAL_SECONDS * 1000,
  );
} else {
  logger.info('log ingestion disabled (backend or log location not configured)');
}

const app = createApp({
  env,
  logger,
  db,
  sessions,
  servers,
  provider,
  metrics,
  consoleHub,
  workshop,
  scheduler,
  resolveLogPath,
  configSync,
  configEditor,
  mods,
  performance,
  resourceHistory,
  missions,
});

const httpServer = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, mockPterodactyl: env.USE_MOCK_PTERODACTYL },
    'reforger-panel API listening',
  );
});

consoleHub?.start();

if (scheduler && resolveLogPath && primaryServer) {
  scheduler.start([
    {
      serverId: primaryServer.id,
      providerServerId,
      resolveLogPath,
    },
  ]);
}

if (primaryServer && configured) {
  resourceHistory.start([{ serverId: primaryServer.id, providerServerId }]);
}

// Import the real config.json once at startup so the panel reflects what the
// server actually runs. Writes trigger their own sync, and every read is live,
// so there is deliberately no background polling loop here.
if (configSync && primaryServer) {
  void configSync
    .syncAllQuietly()
    .then(() => mods?.getMods(primaryServer))
    // Prime the Workshop cache with the installed mod list so the first visit
    // to the Mods page renders without waiting on the network.
    .then((installed) => workshop.warm((installed?.mods ?? []).map((mod) => mod.modId)))
    .catch(() => undefined);
}

// Hourly cleanup of expired sessions.
const sessionCleanup = setInterval(
  () => void sessions.deleteExpiredSessions().catch(() => undefined),
  60 * 60 * 1000,
);
sessionCleanup.unref();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  httpServer.close();
  clearInterval(sessionCleanup);
  resourceHistory.stop();
  await consoleHub?.stop();
  if (scheduler) await scheduler.stop();
  if (mockProvider) mockProvider.dispose();
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
