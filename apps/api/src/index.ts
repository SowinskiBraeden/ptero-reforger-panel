import { createApp } from './app.js';
import { createDb } from './db/client.js';
import { isPterodactylConfigured, loadEnv } from './env.js';
import { createLogger } from './lib/logger.js';
import { SessionService } from './modules/auth/session-service.js';
import { ConfigFileGateway } from './modules/config/config-file-gateway.js';
import { ConfigSyncService } from './modules/config/config-sync.js';
import { ServerModsService } from './modules/config/mods-service.js';
import { PerformanceSettingsService } from './modules/config/performance-service.js';
import { ResourceHistoryService } from './modules/servers/resource-history.js';
import { MissionCatalog } from './modules/reforger-logs/missions-catalog.js';
import { MockGameServerProvider } from './modules/pterodactyl/mock-provider.js';
import { PterodactylProvider } from './modules/pterodactyl/pterodactyl-provider.js';
import type { GameServerProvider } from './modules/pterodactyl/types.js';
import { DrizzleIngestionStore } from './modules/reforger-logs/ingestion/drizzle-store.js';
import { LogIngestionService } from './modules/reforger-logs/ingestion/ingestion-service.js';
import { createLogPathResolver } from './modules/reforger-logs/ingestion/log-path-resolver.js';
import { PterodactylLogSource } from './modules/reforger-logs/ingestion/pterodactyl-log-source.js';
import { IngestionScheduler } from './modules/reforger-logs/ingestion/scheduler.js';
import { ServerService } from './modules/servers/server-service.js';
import { WorkshopClient } from './modules/workshop/workshop-client.js';

const logger = createLogger();

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL);

const mockLogPath = env.REFORGER_ADMIN_LOG_PATH || '/profile/logs/console.log';
const provider: GameServerProvider = env.USE_MOCK_PTERODACTYL
  ? new MockGameServerProvider({ logPath: mockLogPath })
  : new PterodactylProvider({
      baseUrl: env.PTERODACTYL_BASE_URL,
      apiKey: env.PTERODACTYL_CLIENT_API_KEY,
    });

const sessions = new SessionService(db, env.OWNER_DISCORD_ID);
const servers = new ServerService(db);
const workshop = new WorkshopClient({ baseUrl: env.REFORGER_WORKSHOP_API_BASE_URL });
const configSync = isPterodactylConfigured(env)
  ? new ConfigSyncService(provider, servers, logger, env.REFORGER_CONFIG_PATH)
  : null;
const gateway = new ConfigFileGateway(provider, env.REFORGER_CONFIG_PATH);
const mods = configSync ? new ServerModsService(gateway, configSync, logger) : null;
const performance = configSync ? new PerformanceSettingsService(gateway, configSync, logger) : null;
const resourceHistory = new ResourceHistoryService(provider, logger);

// Log ingestion runs when a backend is configured and we know where logs live.
const logsConfigured =
  isPterodactylConfigured(env) &&
  Boolean(env.REFORGER_ADMIN_LOG_PATH || env.REFORGER_LOG_DIRECTORY || env.USE_MOCK_PTERODACTYL);

const primaryServer = (await servers.listServers())[0] ?? null;
const providerServerId = primaryServer
  ? (primaryServer.pterodactylServerId ?? primaryServer.slug)
  : '';

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

const missions =
  resolveLogPath && primaryServer
    ? new MissionCatalog(provider, resolveLogPath, providerServerId)
    : null;

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
  workshop,
  scheduler,
  resolveLogPath,
  configSync,
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

if (scheduler && resolveLogPath && primaryServer) {
  scheduler.start([
    {
      serverId: primaryServer.id,
      providerServerId,
      resolveLogPath,
    },
  ]);
}

if (primaryServer && isPterodactylConfigured(env)) {
  resourceHistory.start([{ serverId: primaryServer.id, providerServerId }]);
}

// Import the real config.json at startup and on an interval so the panel
// always reflects what the server actually runs.
let configSyncTimer: ReturnType<typeof setInterval> | null = null;
if (configSync) {
  void configSync.syncAllQuietly();
  configSyncTimer = setInterval(
    () => void configSync.syncAllQuietly(),
    env.REFORGER_CONFIG_SYNC_INTERVAL_SECONDS * 1000,
  );
  configSyncTimer.unref();
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
  if (configSyncTimer) clearInterval(configSyncTimer);
  resourceHistory.stop();
  if (scheduler) await scheduler.stop();
  if (provider instanceof MockGameServerProvider) provider.dispose();
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
