import { Router } from 'express';
import { z } from 'zod';
import type {
  LogIngestionHealth,
  ServerResources,
  ServerStatus,
  ServerSummary,
} from '@reforger-panel/shared';
import { ApiError } from '../../lib/errors.js';
import { rateLimit } from '../../lib/rate-limit.js';
import { requireAuth, requireCapability } from '../auth/auth-middleware.js';
import type { ConfigSyncService } from '../config/config-sync.js';
import type { ServerModsService } from '../config/mods-service.js';
import type { PerformanceSettingsService } from '../config/performance-service.js';
import type { ResourceHistoryService } from './resource-history.js';
import type { GameServerProvider } from '../pterodactyl/types.js';
import type { LogPathResolver } from '../reforger-logs/ingestion/log-path-resolver.js';
import type { IngestionScheduler, ScheduledServer } from '../reforger-logs/ingestion/scheduler.js';
import type { MissionCatalog } from '../reforger-logs/missions-catalog.js';
import { mergeMissions, scenariosFromWorkshopMod } from '../reforger-logs/missions-catalog.js';
import type { ServerRecord, ServerService } from './server-service.js';
import type { WorkshopClient } from '../workshop/workshop-client.js';

const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'Invalid server slug.');

export type ServerRouterDeps = {
  service: ServerService;
  provider: GameServerProvider;
  scheduler: IngestionScheduler | null;
  resolveLogPath: LogPathResolver | null;
  configSync: ConfigSyncService | null;
  mods: ServerModsService | null;
  performance: PerformanceSettingsService | null;
  resourceHistory: ResourceHistoryService | null;
  missions: MissionCatalog | null;
  workshop: WorkshopClient;
  staleAfterSeconds: number;
  mockMode: boolean;
};

// Validation ranges follow the Bohemia server-config reference. Only provided
// keys are touched; `null` removes the key (the game default applies).
const performanceBodySchema = z
  .object({
    scenarioId: z
      .string()
      .trim()
      .max(200)
      .regex(/^\{[0-9A-Fa-f]{16}\}\S+\.conf$/, 'Invalid scenario id.')
      .nullable(),
    maxPlayers: z.number().int().min(1).max(128).nullable(),
    serverMaxViewDistance: z.number().int().min(500).max(10000).nullable(),
    networkViewDistance: z.number().int().min(500).max(5000).nullable(),
    serverMinGrassDistance: z.number().int().min(0).max(150).nullable(),
    disableThirdPerson: z.boolean().nullable(),
    fastValidation: z.boolean().nullable(),
    battlEye: z.boolean().nullable(),
    aiLimit: z.number().int().min(-1).max(1000).nullable(),
    playerSaveTime: z.number().int().min(1).max(3600).nullable(),
    slotReservationTimeout: z.number().int().min(5).max(300).nullable(),
    lobbyPlayerSynchronise: z.boolean().nullable(),
  })
  .partial()
  .strict();

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
const modsBodySchema = z.object({
  mods: z
    .array(
      z.object({
        modId: z.string().regex(/^[A-Fa-f0-9]{16}$/, 'Invalid mod id.'),
        name: z.string().trim().max(200).optional(),
        version: z
          .string()
          .trim()
          .max(32)
          .regex(/^[\w.+-]*$/, 'Invalid version.')
          .optional(),
      }),
    )
    .max(200),
});

function providerId(server: ServerRecord): string {
  return server.pterodactylServerId ?? server.slug;
}

export function createServerRouter(deps: ServerRouterDeps): Router {
  const router = Router();
  const { service, provider } = deps;
  const powerRateLimit = rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'power' });
  const syncRateLimit = rateLimit({ windowMs: 60_000, max: 6, keyPrefix: 'logsync' });

  router.use(requireAuth);

  async function loadServer(slugRaw: unknown): Promise<ServerRecord> {
    const slug = slugSchema.safeParse(slugRaw);
    if (!slug.success) throw ApiError.validation('Invalid server slug.');
    const server = await service.getServerBySlug(slug.data);
    if (!server) throw ApiError.notFound('Server not found.');
    return server;
  }

  async function toSummary(server: ServerRecord): Promise<ServerSummary> {
    let status = server.status as ServerStatus;
    try {
      status = await provider.getServerStatus(providerId(server));
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
      const server = await loadServer(req.params.slug);
      res.json(await toSummary(server));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:slug/resources', async (req, res, next) => {
    try {
      const server = await loadServer(req.params.slug);
      const resources = await provider.getServerResources(providerId(server));
      const body: ServerResources = { ...resources, fetchedAt: new Date().toISOString() };
      res.json(body);
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
    syncRateLimit,
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
        const result = await deps.performance.update(server, body.data);
        // Many Reforger eggs template config.json from startup variables at
        // boot; mirror the mission there too so switching sticks either way.
        if (result.changedFields.includes('scenarioId') && body.data.scenarioId) {
          await provider
            .updateStartupVariable(providerId(server), 'SCENARIO_ID', body.data.scenarioId)
            .catch(() => undefined); // variable may not exist on this egg
        }
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

  router.get('/:slug/configuration', async (req, res, next) => {
    try {
      const server = await loadServer(req.params.slug);
      if (!deps.configSync) {
        throw ApiError.notConfigured('Configuration requires a configured game server backend.');
      }
      const config = await deps.configSync.getLiveConfig(server);
      res.json({ config, fetchedAt: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:slug/missions', async (req, res, next) => {
    try {
      const server = await loadServer(req.params.slug);
      const logMissions = deps.missions ? (await deps.missions.list()).missions : [];
      const modMissions = [];
      if (deps.mods) {
        const installed = await deps.mods.getMods(server);
        const details = await Promise.allSettled(
          installed.mods.map((mod) => deps.workshop.getMod(mod.modId)),
        );
        for (const result of details) {
          if (result.status === 'fulfilled') {
            modMissions.push(...scenariosFromWorkshopMod(result.value));
          }
        }
      }
      if (!deps.missions && !deps.mods) {
        throw ApiError.notConfigured('Missions require logs or config/mod access.');
      }
      res.json({
        missions: mergeMissions(logMissions, modMissions),
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

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
    syncRateLimit,
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
    syncRateLimit,
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
    syncRateLimit,
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
    syncRateLimit,
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

  router.get('/:slug/mods', async (req, res, next) => {
    try {
      const server = await loadServer(req.params.slug);
      if (!deps.mods) {
        throw ApiError.notConfigured('Mod management requires a configured game server backend.');
      }
      res.json(await deps.mods.getMods(server));
    } catch (error) {
      next(error);
    }
  });

  router.put(
    '/:slug/mods',
    syncRateLimit,
    requireCapability('mods.manage', 'You do not have permission to manage mods.'),
    async (req, res, next) => {
      try {
        const server = await loadServer(req.params.slug);
        if (!deps.mods) {
          throw ApiError.notConfigured('Mod management requires a configured game server backend.');
        }
        const body = modsBodySchema.safeParse(req.body);
        if (!body.success) {
          throw ApiError.validation(body.error.issues[0]?.message ?? 'Invalid mod list.');
        }
        // Reject duplicate mod ids up front instead of silently collapsing.
        const ids = body.data.mods.map((mod) => mod.modId.toUpperCase());
        if (new Set(ids).size !== ids.length) {
          throw ApiError.validation('Duplicate mod ids in the list.');
        }

        // Reforger requires a version in config.json for each mod to load.
        // Fetch it from the Workshop for any mod the caller didn't supply one for.
        const enrichedMods = await Promise.all(
          body.data.mods.map(async (mod) => {
            if (mod.version) return mod;
            try {
              const detail = await deps.workshop.getMod(mod.modId);
              return { ...mod, ...(detail.version ? { version: detail.version } : {}) };
            } catch {
              return mod;
            }
          }),
        );

        const result = await deps.mods.setMods(server, enrichedMods);
        const user = req.user!;
        await service.recordActivity({
          serverId: server.id,
          actorUserId: user.id,
          action: 'mods.updated',
          summary: `Mods updated by ${user.displayName ?? user.username}: ${result.added} added, ${result.removed} removed (${result.mods.length} total, applies on restart)`,
          metadata: { added: result.added, removed: result.removed, total: result.mods.length },
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
        // Config is served live; this just refreshes the stored name/capacity.
        const result = await deps.configSync.sync(server);
        res.json({ ok: true, serverName: result.serverName, maxPlayers: result.maxPlayers });
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
