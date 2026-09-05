import { Router } from 'express';
import { z } from 'zod';
import type {
  ConfigPatchOp,
  LogIngestionHealth,
  ReforgerConfigMod,
  ServerStatus,
  ServerSummary,
} from '@reforger-panel/shared';
import { ApiError } from '../../lib/errors.js';
import { rateLimit } from '../../lib/rate-limit.js';
import { requireAuth, requireCapability } from '../auth/auth-middleware.js';
import type { ConfigEditorService } from '../config/config-editor-service.js';
import type { ConfigSyncService } from '../config/config-sync.js';
import type { ServerModsService } from '../config/mods-service.js';
import type { PerformanceSettingsService } from '../config/performance-service.js';
import type { ConsoleHub } from '../pterodactyl/console-hub.js';
import type { GameServerProvider } from '../pterodactyl/types.js';
import type { LogPathResolver } from '../reforger-logs/ingestion/log-path-resolver.js';
import type { IngestionScheduler, ScheduledServer } from '../reforger-logs/ingestion/scheduler.js';
import type { MissionsService } from '../reforger-logs/missions-catalog.js';
import type { WorkshopCache } from '../workshop/workshop-cache.js';
import type { ServerMetricsService } from './metrics-service.js';
import type { ResourceHistoryService } from './resource-history.js';
import type { ServerRecord, ServerService } from './server-service.js';

const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'Invalid server slug.');

export type ServerRouterDeps = {
  service: ServerService;
  provider: GameServerProvider;
  metrics: ServerMetricsService;
  consoleHub: ConsoleHub | null;
  scheduler: IngestionScheduler | null;
  resolveLogPath: LogPathResolver | null;
  configSync: ConfigSyncService | null;
  configEditor: ConfigEditorService | null;
  mods: ServerModsService | null;
  performance: PerformanceSettingsService | null;
  resourceHistory: ResourceHistoryService | null;
  missions: MissionsService;
  workshop: WorkshopCache;
  staleAfterSeconds: number;
  mockMode: boolean;
};

const revisionSchema = z.string().regex(/^[a-f0-9]{8,64}$/, 'Invalid revision.');

// Validation ranges follow the Bohemia server-config reference. Only provided
// keys are touched; `null` removes the key (the game default applies).
const performanceSettingsSchema = z
  .object({
    scenarioId: z
      .string()
      .trim()
      .max(200)
      // Allow spaces in the path portion (some modded scenario IDs contain them).
      .regex(/^\{[0-9A-Fa-f]{16}\}[^\0\r\n]+\.conf$/, 'Invalid scenario id.')
      .nullable(),
    maxPlayers: z.number().int().min(1).max(128).nullable(),
    serverMaxViewDistance: z.number().int().min(500).max(10000).nullable(),
    networkViewDistance: z.number().int().min(500).max(5000).nullable(),
    serverMinGrassDistance: z.number().int().min(0).max(150).nullable(),
    disableThirdPerson: z.boolean().nullable(),
    fastValidation: z.boolean().nullable(),
    battlEye: z.boolean().nullable(),
    disableAI: z.boolean().nullable(),
    aiLimit: z.number().int().min(-1).max(1000).nullable(),
    playerSaveTime: z.number().int().min(1).max(3600).nullable(),
    slotReservationTimeout: z.number().int().min(5).max(300).nullable(),
    lobbyPlayerSynchronise: z.boolean().nullable(),
  })
  .partial()
  .strict();

const performanceBodySchema = z.object({
  settings: performanceSettingsSchema,
  expectedRevision: revisionSchema.optional(),
  writeStartupVars: z.boolean().default(true),
});

/**
 * Dotted config paths only — no array indices, no prototype-polluting
 * segments. `game.mods` is owned by the mods endpoints, which understand
 * versions and dependencies, so it is refused here.
 */
const configPathSchema = z
  .string()
  .max(200)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/, 'Invalid config path.')
  .refine((path) => !path.split('.').some((segment) => segment === '__proto__'), 'Invalid path.')
  .refine((path) => path !== 'game.mods' && !path.startsWith('game.mods.'), {
    message: 'The mod list is managed on the Mods page.',
  });

const configPatchBodySchema = z.object({
  ops: z
    .array(
      z.object({
        path: configPathSchema,
        value: z.union([z.string().max(4000), z.number(), z.boolean(), z.null()]),
      }),
    )
    .min(1)
    .max(200),
  expectedRevision: revisionSchema.optional(),
  writeStartupVars: z.boolean().default(false),
});

const configRawBodySchema = z.object({
  content: z
    .string()
    .min(2)
    .max(256 * 1024),
  expectedRevision: revisionSchema.optional(),
});

const startupVariableBodySchema = z.object({
  key: z.string().regex(/^[A-Z0-9_]{1,64}$/, 'Invalid variable name.'),
  value: z.string().max(500),
});

const restartScheduleBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  isActive: z.boolean(),
  minute: z.number().int().min(0).max(59),
  hour: z.number().int().min(0).max(23),
  dayOfWeek: z.enum(['*', '0', '1', '2', '3', '4', '5', '6']),
  onlyWhenOnline: z.boolean(),
});

const scheduleIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid schedule id.');

// Reforger Workshop mod IDs are 16 hex characters (see the Bohemia server
// config reference); name/version are free-ish text with sane caps.
const modEntrySchema = z.object({
  modId: z.string().regex(/^[A-Fa-f0-9]{16}$/, 'Invalid mod id.'),
  name: z.string().trim().max(200).optional(),
  version: z
    .string()
    .trim()
    .max(32)
    .regex(/^[\w.+-]*$/, 'Invalid version.')
    .optional(),
});

const modsBodySchema = z.object({
  mods: z.array(modEntrySchema).max(300),
  expectedRevision: revisionSchema.optional(),
});

const modsResolveBodySchema = z.object({
  mods: z.array(modEntrySchema).max(300),
});

function providerId(server: ServerRecord): string {
  return server.pterodactylServerId ?? server.slug;
}

/** Rejects duplicate mod ids up front instead of silently collapsing them. */
function assertNoDuplicates(mods: readonly ReforgerConfigMod[]): void {
  const ids = mods.map((mod) => mod.modId.toUpperCase());
  if (new Set(ids).size !== ids.length) {
    throw ApiError.validation('Duplicate mod ids in the list.');
  }
}

export function createServerRouter(deps: ServerRouterDeps): Router {
  const router = Router();
  const { service, provider, metrics } = deps;
  const powerRateLimit = rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'power' });
  const writeRateLimit = rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'configwrite' });
  const syncRateLimit = rateLimit({ windowMs: 60_000, max: 6, keyPrefix: 'logsync' });

  router.use(requireAuth);

  async function loadServer(slugRaw: unknown): Promise<ServerRecord> {
    const slug = slugSchema.safeParse(slugRaw);
    if (!slug.success) throw ApiError.validation('Invalid server slug.');
    const server = await service.getServerBySlug(slug.data);
    if (!server) throw ApiError.notFound('Server not found.');
    return server;
  }

  function requireMods(): ServerModsService {
    if (!deps.mods) {
      throw ApiError.notConfigured('Mod management requires a configured game server backend.');
    }
    return deps.mods;
  }

  function requireConfigEditor(): ConfigEditorService {
    if (!deps.configEditor) {
      throw ApiError.notConfigured('Config editing requires a configured game server backend.');
    }
    return deps.configEditor;
  }

  async function toSummary(server: ServerRecord): Promise<ServerSummary> {
    let status = server.status as ServerStatus;
    try {
      status = await metrics.getStatus(providerId(server));
      if (status !== server.status) {
        await service.updateStatus(server.id, status);
      }
    } catch {
      // Provider unreachable: fall back to the last stored status.
    }
    return {
      id: server.id,
      slug: server.slug,
      name: server.name,
      providerType: server.providerType,
      status,
      maxPlayers: server.maxPlayers,
      onlinePlayerCount: await service.countOnlinePlayers(server.id),
      createdAt: server.createdAt.toISOString(),
      updatedAt: server.updatedAt.toISOString(),
    };
  }

  // ---------- server identity & telemetry ----------

  router.get('/', async (_req, res, next) => {
    try {
      const servers = await service.listServers();
      res.json({ servers: await Promise.all(servers.map((s) => toSummary(s))) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:slug', async (req, res, next) => {
    try {
      res.json(await toSummary(await loadServer(req.params.slug)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:slug/resources', async (req, res, next) => {
    try {
      const server = await loadServer(req.params.slug);
      res.json(await metrics.getResources(providerId(server)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:slug/resources/history', async (req, res, next) => {
    try {
      const server = await loadServer(req.params.slug);
      if (!deps.resourceHistory) {
        throw ApiError.notConfigured('Resource history requires a configured game server backend.');
      }
      res.json(deps.resourceHistory.history(server.id));
    } catch (error) {
      next(error);
    }
  });

  // ---------- configuration ----------

  router.get('/:slug/configuration', async (req, res, next) => {
    try {
      const server = await loadServer(req.params.slug);
      if (!deps.configSync) {
        throw ApiError.notConfigured('Configuration requires a configured game server backend.');
      }
      const { config, revision } = await deps.configSync.getLiveConfig(server);
      res.json({ config, revision, fetchedAt: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:slug/config/performance', async (req, res, next) => {
    try {
      const server = await loadServer(req.params.slug);
      if (!deps.performance) {
        throw ApiError.notConfigured('Config editing requires a configured game server backend.');
      }
      res.json(await deps.performance.get(server));
    } catch (error) {
      next(error);
    }
  });

  router.put(
    '/:slug/config/performance',
    writeRateLimit,
    requireCapability('config.edit', 'You do not have permission to edit the configuration.'),
    async (req, res, next) => {
      try {
        const server = await loadServer(req.params.slug);
        if (!deps.performance) {
          throw ApiError.notConfigured('Config editing requires a configured game server backend.');
        }
        const body = performanceBodySchema.safeParse(req.body);
        if (!body.success) {
          const issue = body.error.issues[0];
          throw ApiError.validation(
            issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid settings.',
          );
        }
        const result = await deps.performance.update(server, body.data.settings, {
          expectedRevision: body.data.expectedRevision,
          writeStartupVars: body.data.writeStartupVars,
        });
        if (result.changedFields.length > 0) {
          const user = req.user!;
          await service.recordActivity({
            serverId: server.id,
            actorUserId: user.id,
            action: 'config.performance.updated',
            summary: `Performance settings updated by ${user.displayName ?? user.username}: ${result.changedFields.join(', ')} (applies on restart)`,
            metadata: { changedFields: result.changedFields },
          });
        }
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  /** Every key config.json actually contains, for the searchable editor. */
  router.get(
    '/:slug/config/tree',
    requireCapability('config.edit', 'Configuration editing is restricted.'),
    async (req, res, next) => {
      try {
        const server = await loadServer(req.params.slug);
        res.json(await requireConfigEditor().getTree(server));
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    '/:slug/config',
    writeRateLimit,
    requireCapability('config.edit', 'You do not have permission to edit the configuration.'),
    async (req, res, next) => {
      try {
        const server = await loadServer(req.params.slug);
        const body = configPatchBodySchema.safeParse(req.body);
        if (!body.success) {
          const issue = body.error.issues[0];
          throw ApiError.validation(issue?.message ?? 'Invalid configuration patch.');
        }
        const ops: ConfigPatchOp[] = body.data.ops;
        const result = await requireConfigEditor().patch(server, ops, {
          expectedRevision: body.data.expectedRevision,
          writeStartupVars: body.data.writeStartupVars,
        });
        if (result.changedPaths.length > 0) {
          const user = req.user!;
          await service.recordActivity({
            serverId: server.id,
            actorUserId: user.id,
            action: 'config.updated',
            // Paths only — values can be passwords.
            summary: `config.json updated by ${user.displayName ?? user.username}: ${result.changedPaths.join(', ')} (applies on restart)`,
            metadata: { changedPaths: result.changedPaths },
          });
        }
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/:slug/config/raw',
    requireCapability('config.edit', 'Configuration editing is restricted.'),
    async (req, res, next) => {
      try {
        const server = await loadServer(req.params.slug);
        res.json(await requireConfigEditor().getRaw(server));
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/:slug/config/raw',
    writeRateLimit,
    requireCapability('config.edit', 'You do not have permission to edit the configuration.'),
    async (req, res, next) => {
      try {
        const server = await loadServer(req.params.slug);
        const body = configRawBodySchema.safeParse(req.body);
        if (!body.success) throw ApiError.validation('Invalid config.json payload.');
        const result = await requireConfigEditor().putRaw(
          server,
          body.data.content,
          body.data.expectedRevision,
        );
        const user = req.user!;
        await service.recordActivity({
          serverId: server.id,
          actorUserId: user.id,
          action: 'config.raw.updated',
          summary: `config.json replaced by ${user.displayName ?? user.username} (applies on restart)`,
          metadata: { revision: result.revision },
        });
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/:slug/config/sync',
    syncRateLimit,
    requireCapability('ops.health.view', 'Config sync is restricted to owner and server admins.'),
    async (req, res, next) => {
      try {
        const server = await loadServer(req.params.slug);
        if (!deps.configSync) {
          throw ApiError.notConfigured('Config import requires a configured game server backend.');
        }
        const result = await deps.configSync.sync(server);
        res.json({ ok: true, serverName: result.serverName, maxPlayers: result.maxPlayers });
      } catch (error) {
        next(error);
      }
    },
  );

  // ---------- players, activity, killfeed ----------

  router.get('/:slug/players', async (req, res, next) => {
    try {
      const server = await loadServer(req.params.slug);
      res.json(await service.getOnlinePlayers(server, deps.staleAfterSeconds));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:slug/players/known', async (req, res, next) => {
    try {
      const server = await loadServer(req.params.slug);
      res.json({ players: await service.getKnownPlayers(server.id) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:slug/activity', async (req, res, next) => {
    try {
      const server = await loadServer(req.params.slug);
      const limit = z.coerce.number().int().min(1).max(200).default(50).parse(req.query.limit);
      res.json({ activity: await service.getActivity(server.id, limit) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:slug/killfeed', async (req, res, next) => {
    try {
      const server = await loadServer(req.params.slug);
      const limit = z.coerce.number().int().min(1).max(500).default(100).parse(req.query.limit);
      res.json({ events: await service.getKillfeed(server.id, limit) });
    } catch (error) {
      next(error);
    }
  });

  // ---------- missions ----------

  router.get('/:slug/missions', async (req, res, next) => {
    try {
      const server = await loadServer(req.params.slug);
      let installed: ReforgerConfigMod[] = [];
      if (deps.mods) {
        installed = (await deps.mods.getMods(server)).mods;
      } else if (deps.configSync) {
        const live = await deps.configSync.getLiveConfig(server).catch(() => null);
        installed = live?.config.mods ?? [];
      }
      res.json(await deps.missions.list(installed));
    } catch (error) {
      next(error);
    }
  });

  // ---------- live console ----------

  /**
   * Server-Sent Events relay of the Pterodactyl/Wings feed.
   *
   * This is what makes install, update and mod-download output visible: it
   * carries whatever the hosting backend emits, rather than tailing the game's
   * own log file, which does not exist until the game has already started.
   */
  router.get(
    '/:slug/console/stream',
    requireCapability('ops.health.view', 'Live console stream is restricted.'),
    async (req, res, next) => {
      try {
        await loadServer(req.params.slug);
        const hub = deps.consoleHub;
        if (!hub) {
          throw ApiError.notConfigured(
            'Live console requires a configured game server backend with the websocket enabled.',
          );
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.flushHeaders();

        const send = (event: string, data: unknown) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        send('backlog', hub.backlog());
        const stats = hub.latestStats();
        if (stats) send('stats', stats);

        const unsubscribe = hub.subscribe((event) => {
          switch (event.type) {
            case 'line':
              send('line', event.line);
              break;
            case 'status':
              send('status', { status: event.status });
              break;
            case 'stats':
              send('stats', event.stats);
              break;
          }
        });

        // Proxies drop idle connections; a comment frame keeps them open.
        const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
        heartbeat.unref?.();

        req.on('close', () => {
          clearInterval(heartbeat);
          unsubscribe();
          res.end();
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/:slug/console/backlog',
    requireCapability('ops.health.view', 'Live console is restricted.'),
    async (req, res, next) => {
      try {
        await loadServer(req.params.slug);
        if (!deps.consoleHub) {
          throw ApiError.notConfigured('Live console requires a configured game server backend.');
        }
        res.json(deps.consoleHub.backlog());
      } catch (error) {
        next(error);
      }
    },
  );

  /** The game's own log file — kept as a diagnostic alongside the live feed. */
  router.get(
    '/:slug/logs/raw',
    requireCapability('ops.health.view', 'Raw logs are restricted.'),
    async (req, res, next) => {
      try {
        const server = await loadServer(req.params.slug);
        if (!deps.resolveLogPath) {
          throw ApiError.notConfigured('Log access requires a configured game server backend.');
        }
        const lineCount = z.coerce
          .number()
          .int()
          .min(10)
          .max(1000)
          .default(300)
          .parse(req.query.lines);
        const logPath = await deps.resolveLogPath();
        if (!logPath) throw ApiError.notConfigured('Could not locate the current log file.');
        const file = await provider.downloadTextFile(providerId(server), logPath, 512 * 1024);
        const allLines = file.content.split('\n');
        res.json({
          path: logPath,
          lines: allLines.slice(-lineCount),
          truncated: file.truncated || allLines.length > lineCount,
          fetchedAt: new Date().toISOString(),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  // ---------- startup variables ----------

  router.get(
    '/:slug/startup',
    requireCapability('config.edit', 'Startup variables are restricted.'),
    async (req, res, next) => {
      try {
        const server = await loadServer(req.params.slug);
        const variables = await provider.listStartupVariables(providerId(server));
        res.json({
          variables: variables.map((v) => ({
            name: v.name,
            description: v.description,
            envVariable: v.envVariable,
            value: v.serverValue,
            defaultValue: v.defaultValue,
            isEditable: v.isEditable,
          })),
          fetchedAt: new Date().toISOString(),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/:slug/startup/variable',
    writeRateLimit,
    requireCapability('config.edit', 'Startup variables are restricted.'),
    async (req, res, next) => {
      try {
        const server = await loadServer(req.params.slug);
        const body = startupVariableBodySchema.safeParse(req.body);
        if (!body.success) throw ApiError.validation('Invalid startup variable update.');
        await provider.updateStartupVariable(providerId(server), body.data.key, body.data.value);
        const user = req.user!;
        // Never put the value in the activity feed — these can be passwords.
        await service.recordActivity({
          serverId: server.id,
          actorUserId: user.id,
          action: 'startup.variable.updated',
          summary: `Startup variable ${body.data.key} updated by ${user.displayName ?? user.username} (applies on restart)`,
          metadata: { key: body.data.key },
        });
        res.json({ ok: true, requiresRestart: true });
      } catch (error) {
        next(error);
      }
    },
  );

  // ---------- schedules ----------

  router.get(
    '/:slug/schedules',
    requireCapability('config.edit', 'Schedule management is restricted.'),
    async (req, res, next) => {
      try {
        const server = await loadServer(req.params.slug);
        res.json({
          schedules: await provider.listSchedules(providerId(server)),
          fetchedAt: new Date().toISOString(),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/:slug/schedules/restarts',
    writeRateLimit,
    requireCapability('config.edit', 'Schedule management is restricted.'),
    async (req, res, next) => {
      try {
        const server = await loadServer(req.params.slug);
        const body = restartScheduleBodySchema.safeParse(req.body);
        if (!body.success) throw ApiError.validation('Invalid restart schedule.');
        const schedule = await provider.createRestartSchedule(providerId(server), body.data);
        const user = req.user!;
        await service.recordActivity({
          serverId: server.id,
          actorUserId: user.id,
          action: 'schedule.restart.created',
          summary: `Restart schedule "${schedule.name}" created by ${user.displayName ?? user.username}`,
          metadata: { scheduleId: schedule.id },
        });
        res.json({ schedule });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/:slug/schedules/:scheduleId/restart',
    writeRateLimit,
    requireCapability('config.edit', 'Schedule management is restricted.'),
    async (req, res, next) => {
      try {
        const server = await loadServer(req.params.slug);
        const scheduleId = scheduleIdSchema.safeParse(req.params.scheduleId);
        if (!scheduleId.success) throw ApiError.validation('Invalid schedule id.');
        const body = restartScheduleBodySchema.safeParse(req.body);
        if (!body.success) throw ApiError.validation('Invalid restart schedule.');
        const schedule = await provider.updateRestartSchedule(
          providerId(server),
          scheduleId.data,
          body.data,
        );
        const user = req.user!;
        await service.recordActivity({
          serverId: server.id,
          actorUserId: user.id,
          action: 'schedule.restart.updated',
          summary: `Restart schedule "${schedule.name}" updated by ${user.displayName ?? user.username}`,
          metadata: { scheduleId: schedule.id },
        });
        res.json({ schedule });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/:slug/schedules/:scheduleId',
    writeRateLimit,
    requireCapability('config.edit', 'Schedule management is restricted.'),
    async (req, res, next) => {
      try {
        const server = await loadServer(req.params.slug);
        const scheduleId = scheduleIdSchema.safeParse(req.params.scheduleId);
        if (!scheduleId.success) throw ApiError.validation('Invalid schedule id.');
        await provider.deleteSchedule(providerId(server), scheduleId.data);
        const user = req.user!;
        await service.recordActivity({
          serverId: server.id,
          actorUserId: user.id,
          action: 'schedule.deleted',
          summary: `Schedule deleted by ${user.displayName ?? user.username}`,
          metadata: { scheduleId: scheduleId.data },
        });
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    },
  );

  // ---------- mods ----------

  router.get('/:slug/mods', async (req, res, next) => {
    try {
      res.json(await requireMods().getMods(await loadServer(req.params.slug)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * Everything the Mods page renders, in one request: installed mods joined
   * with cached Workshop metadata, latest versions, dependency gaps and
   * removal blockers. Replaces the old fan-out of one browser request per mod.
   */
  router.get('/:slug/mods/overview', async (req, res, next) => {
    try {
      res.json(await requireMods().getOverview(await loadServer(req.params.slug)));
    } catch (error) {
      next(error);
    }
  });

  /** Expands a staged mod list into its full dependency closure, with sizes. */
  router.post('/:slug/mods/resolve', async (req, res, next) => {
    try {
      await loadServer(req.params.slug);
      const body = modsResolveBodySchema.safeParse(req.body);
      if (!body.success) {
        throw ApiError.validation(body.error.issues[0]?.message ?? 'Invalid mod list.');
      }
      assertNoDuplicates(body.data.mods);
      res.json(await requireMods().resolve(body.data.mods));
    } catch (error) {
      next(error);
    }
  });

  router.put(
    '/:slug/mods',
    writeRateLimit,
    requireCapability('mods.manage', 'You do not have permission to manage mods.'),
    async (req, res, next) => {
      try {
        const server = await loadServer(req.params.slug);
        const mods = requireMods();
        const body = modsBodySchema.safeParse(req.body);
        if (!body.success) {
          throw ApiError.validation(body.error.issues[0]?.message ?? 'Invalid mod list.');
        }
        assertNoDuplicates(body.data.mods);

        // Reforger needs a version in config.json for each mod to load. Fill in
        // the latest known version for any entry the caller left unpinned.
        const enriched = await Promise.all(
          body.data.mods.map(async (mod) => {
            if (mod.version) return mod;
            const detail = await deps.workshop.tryGetMod(mod.modId);
            return detail?.version ? { ...mod, version: detail.version } : mod;
          }),
        );

        const result = await mods.setMods(server, enriched, body.data.expectedRevision);
        const user = req.user!;
        await service.recordActivity({
          serverId: server.id,
          actorUserId: user.id,
          action: 'mods.updated',
          summary: `Mods updated by ${user.displayName ?? user.username}: ${result.added} added, ${result.removed} removed, ${result.changed} re-versioned (${result.mods.length} total, applies on restart)`,
          metadata: {
            added: result.added,
            removed: result.removed,
            changed: result.changed,
            total: result.mods.length,
          },
        });
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get('/:slug/mod-packs', async (req, res, next) => {
    try {
      const server = await loadServer(req.params.slug);
      res.json({ modPacks: await service.getModPacks(server.id) });
    } catch (error) {
      next(error);
    }
  });

  // ---------- power ----------

  const powerActions = [
    {
      action: 'start' as const,
      capability: 'server.power.start' as const,
      message: 'You do not have permission to start this server.',
      run: (id: string) => provider.startServer(id),
    },
    {
      action: 'stop' as const,
      capability: 'server.power.stop' as const,
      message: 'You do not have permission to stop this server.',
      run: (id: string) => provider.stopServer(id),
    },
    {
      action: 'restart' as const,
      capability: 'server.power.restart' as const,
      message: 'You do not have permission to restart this server.',
      run: (id: string) => provider.restartServer(id),
    },
  ];

  for (const { action, capability, message, run } of powerActions) {
    router.post(
      `/:slug/power/${action}`,
      powerRateLimit,
      requireCapability(capability, message),
      async (req, res, next) => {
        try {
          const server = await loadServer(req.params.slug);
          await run(providerId(server));
          const user = req.user!;
          await service.recordActivity({
            serverId: server.id,
            actorUserId: user.id,
            action: `server.power.${action}`,
            summary: `Server ${action} requested by ${user.displayName ?? user.username}${
              deps.mockMode ? ' (mock mode)' : ''
            }`,
            metadata: { action, mock: deps.mockMode },
          });
          res.json({ ok: true, action, simulated: deps.mockMode });
        } catch (error) {
          next(error);
        }
      },
    );
  }

  // ---------- log ingestion ----------

  router.post(
    '/:slug/logs/sync',
    syncRateLimit,
    requireCapability('logs.sync', 'Only the owner can trigger a manual log sync.'),
    async (req, res, next) => {
      try {
        const server = await loadServer(req.params.slug);
        if (!deps.scheduler || !deps.resolveLogPath) {
          throw ApiError.notConfigured(
            'Log ingestion is not configured. Set REFORGER_LOG_DIRECTORY (or REFORGER_ADMIN_LOG_PATH) and the Pterodactyl variables.',
          );
        }
        const target: ScheduledServer = {
          serverId: server.id,
          providerServerId: providerId(server),
          resolveLogPath: deps.resolveLogPath,
        };
        const result = await deps.scheduler.syncNow(target);
        const user = req.user!;
        await service.recordActivity({
          serverId: server.id,
          actorUserId: user.id,
          action: 'logs.sync.manual',
          summary: `Manual log sync by ${user.displayName ?? user.username} (${result.createdEvents} new events)`,
          metadata: { createdEvents: result.createdEvents, processedLines: result.processedLines },
        });
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/:slug/logs/health',
    requireCapability('ops.health.view', 'Operational diagnostics are restricted.'),
    async (req, res, next) => {
      try {
        const server = await loadServer(req.params.slug);
        const cursor = await service.getLogCursor(server.id);
        const lastResult = deps.scheduler?.getLastResult(server.id) ?? null;
        const lastSyncAt = cursor?.lastSuccessfulSyncAt ?? null;
        const body: LogIngestionHealth = {
          configured: Boolean(deps.scheduler && deps.resolveLogPath),
          running: Boolean(deps.scheduler),
          logPath: cursor?.logPath ?? null,
          lastSuccessfulSyncAt: lastSyncAt?.toISOString() ?? null,
          lastErrorAt: cursor?.lastErrorAt?.toISOString() ?? null,
          lastErrorMessage: cursor?.lastErrorMessage ?? null,
          lastSync: lastResult
            ? {
                processedLines: lastResult.processedLines,
                createdEvents: lastResult.createdEvents,
                updatedSessions: lastResult.updatedSessions,
              }
            : null,
          stale: !lastSyncAt || Date.now() - lastSyncAt.getTime() > deps.staleAfterSeconds * 1000,
        };
        res.json(body);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
