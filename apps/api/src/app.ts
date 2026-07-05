import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ApiErrorBody } from '@reforger-panel/shared';
import type { Env } from './env.js';
import type { Db } from './db/client.js';
import { ApiError } from './lib/errors.js';
import type { Logger } from './lib/logger.js';
import { createAuthRouter } from './modules/auth/auth-routes.js';
import { csrfProtection, sessionResolver } from './modules/auth/auth-middleware.js';
import type { SessionService } from './modules/auth/session-service.js';
import type { ConfigSyncService } from './modules/config/config-sync.js';
import type { ServerModsService } from './modules/config/mods-service.js';
import type { PerformanceSettingsService } from './modules/config/performance-service.js';
import type { ResourceHistoryService } from './modules/servers/resource-history.js';
import type { MissionCatalog } from './modules/reforger-logs/missions-catalog.js';
import type { GameServerProvider } from './modules/pterodactyl/types.js';
import type { LogPathResolver } from './modules/reforger-logs/ingestion/log-path-resolver.js';
import type { IngestionScheduler } from './modules/reforger-logs/ingestion/scheduler.js';
import { createServerRouter } from './modules/servers/server-routes.js';
import type { ServerService } from './modules/servers/server-service.js';
import { createInviteRouter } from './modules/invites/invite-routes.js';
import { createUserRouter } from './modules/users/user-routes.js';
import { createWorkshopRouter } from './modules/workshop/workshop-routes.js';
import type { WorkshopClient } from './modules/workshop/workshop-client.js';

export type AppDeps = {
  env: Env;
  logger: Logger;
  db: Db;
  sessions: SessionService;
  servers: ServerService;
  provider: GameServerProvider;
  workshop: WorkshopClient;
  scheduler: IngestionScheduler | null;
  resolveLogPath: LogPathResolver | null;
  configSync: ConfigSyncService | null;
  mods: ServerModsService | null;
  performance: PerformanceSettingsService | null;
  resourceHistory: ResourceHistoryService | null;
  missions: MissionCatalog | null;
};

export function createApp(deps: AppDeps) {
  const { env, logger } = deps;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '64kb' }));

  // Request id + minimal structured request logging.
  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.on('finish', () => {
      logger.debug(
        { requestId, method: req.method, path: req.path, status: res.statusCode },
        'request',
      );
    });
    next();
  });

  // Safe CORS default: only the configured web origin, with credentials.
  const allowedOrigin = env.WEB_ORIGIN.replace(/\/$/, '');
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && origin.replace(/\/$/, '') === allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-CSRF-Protection');
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(sessionResolver(deps.sessions));

  // CSRF protection for all state-changing requests. The OAuth callback is a
  // GET and is protected by the signed state parameter instead.
  const csrf = csrfProtection([allowedOrigin, `http://localhost:${env.PORT}`]);
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      next();
      return;
    }
    csrf(req, res, next);
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', createAuthRouter(env, deps.sessions));
  app.use('/api/users', createUserRouter(deps.db));
  app.use('/api/invites', createInviteRouter(deps.db));
  app.use(
    '/api/servers',
    createServerRouter({
      service: deps.servers,
      provider: deps.provider,
      scheduler: deps.scheduler,
      resolveLogPath: deps.resolveLogPath,
      configSync: deps.configSync,
      mods: deps.mods,
      performance: deps.performance,
      resourceHistory: deps.resourceHistory,
      missions: deps.missions,
      workshop: deps.workshop,
      staleAfterSeconds: env.REFORGER_LOG_STALE_AFTER_SECONDS,
      mockMode: env.USE_MOCK_PTERODACTYL,
    }),
  );
  app.use('/api/workshop', createWorkshopRouter(deps.workshop));

  app.use('/api', (_req, _res, next) => {
    next(ApiError.notFound('Unknown API route.'));
  });

  // Production: serve the built SPA from the same process (no separate web
  // server needed). In development Vite serves the frontend instead.
  const webDist = env.WEB_DIST_PATH || path.resolve(process.cwd(), '../web/dist');
  const webIndex = path.join(webDist, 'index.html');
  if (env.NODE_ENV === 'production' && existsSync(webIndex)) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(webIndex);
    });
    logger.info({ webDist }, 'serving web app from API process');
  }

  // Structured error responses; internals are logged, never sent to clients.
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = String(res.locals.requestId ?? '');
    if (error instanceof ApiError) {
      const body: ApiErrorBody = {
        error: { code: error.code, message: error.message, requestId },
      };
      res.status(error.status).json(body);
      return;
    }
    logger.error(
      { requestId, path: req.path, err: error instanceof Error ? error.message : String(error) },
      'unhandled error',
    );
    const body: ApiErrorBody = {
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.', requestId },
    };
    res.status(500).json(body);
  });

  return app;
}
