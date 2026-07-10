import { Router } from 'express';
import { z } from 'zod';
import type {
  LogIngestionHealth,
  MissionInfo,
  ModDependencyIssue,
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
import {
  DEFAULT_MISSION,
  DEFAULT_SCENARIO_ID,
  hasScenarioTag,
  mergeMissions,
  scenariosFromWorkshopMod,
} from '../reforger-logs/missions-catalog.js';
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

      // Resolve the installed mod list from config.json.
      // Prefer the mods service (already owns that parse); fall back to configSync.
      let installedModIds: string[] = [];
      if (deps.mods) {
        const modsData = await deps.mods.getMods(server);
        installedModIds = modsData.mods.map((m) => m.modId);
      } else if (deps.configSync) {
        const config = await deps.configSync.getLiveConfig(server).catch(() => null);
        installedModIds = (config?.mods ?? []).map((m) => m.modId);
      }

      // Workshop API -> scenarios from installed scenario-tagged mods.
      const modMissions: MissionInfo[] = [];
      let scenarioLookupComplete = true;
      if (installedModIds.length > 0) {
        const details = await Promise.allSettled(
          installedModIds.map((modId) => deps.workshop.getMod(modId)),
        );
        scenarioLookupComplete = details.every((result) => result.status === 'fulfilled');
        for (const result of details) {
          if (result.status !== 'fulfilled') continue;
          const mod = result.value;
          if (hasScenarioTag(mod.tags)) {
            modMissions.push(...scenariosFromWorkshopMod(mod));
          }
        }
      }

      res.json({
        missions: mergeMissions([DEFAULT_MISSION], modMissions),
        fetchedAt: scenarioLookupComplete ? new Date().toISOString() : null,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    '/:slug/logs/stream',
    requireCapability('ops.health.view', 'Live console stream is restricted.'),
    async (req, res, next) => {
      try {
        const server = await loadServer(req.params.slug);
        if (!deps.resolveLogPath) {
          throw ApiError.notConfigured('Log streaming requires a configured game server backend.');
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.flushHeaders();

        const controller = new AbortController();
        req.on('close', () => controller.abort());

        // Poll the log file every 2 seconds and push only new lines via SSE.
        // Tracks total file size to derive the new-content offset on each poll,
        // so we never re-send lines and handle log rotation gracefully.
        let lastTotalBytes = 0;

        const sleep = (ms: number) =>
          new Promise<void>((resolve) => {
            const t = setTimeout(resolve, ms);
            controller.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(t);
                resolve();
              },
              { once: true },
            );
          });

        while (!controller.signal.aborted) {
          try {
            const logPath = await deps.resolveLogPath();
            if (logPath) {
              const file = await provider.downloadTextFile(providerId(server), logPath, 512 * 1024);
              const totalBytes =
                file.totalSizeBytes ?? file.contentStartOffset + file.content.length;

              let newContent: string;
              if (lastTotalBytes === 0 || totalBytes < lastTotalBytes) {
                // First poll or log rotated — send all available content.
                newContent = file.content;
              } else {
                const skip = Math.max(0, lastTotalBytes - file.contentStartOffset);
                newContent = file.content.slice(skip);
              }
              lastTotalBytes = totalBytes;

              if (newContent) {
                for (const line of newContent.split('\n')) {
                  if (controller.signal.aborted) break;
                  if (line) res.write(`data: ${JSON.stringify(line)}\n\n`);
                }
              }
            }
          } catch {
            // Provider unreachable or no log yet — keep the connection alive.
          }
          await sleep(2000);
        }

        res.end();
      } catch (error) {
        next(error);
      }
    },
  );

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

  router.get('/:slug/mods/check', async (req, res, next) => {
    try {
      const server = await loadServer(req.params.slug);
      if (!deps.mods) {
        throw ApiError.notConfigured('Mod management requires a configured game server backend.');
      }
      const { mods } = await deps.mods.getMods(server);
      const installedIds = new Set(mods.map((m) => m.modId.toUpperCase()));

      // Fetch workshop details for all installed mods in parallel.
      const details = await Promise.allSettled(mods.map((mod) => deps.workshop.getMod(mod.modId)));

      const modsWithMissingVersions: string[] = [];
      const modsWithMissingDeps: ModDependencyIssue[] = [];

      for (let i = 0; i < mods.length; i++) {
        const mod = mods[i]!;
        if (!mod.version) modsWithMissingVersions.push(mod.modId);
        const result = details[i]!;
        if (result.status === 'fulfilled') {
          const missing = result.value.dependencies.filter(
            (dep) => dep.id && !installedIds.has(dep.id.toUpperCase()),
          );
          if (missing.length > 0) {
            modsWithMissingDeps.push({
              modId: mod.modId,
              modName: mod.name ?? result.value.name ?? null,
              missing,
            });
          }
        }
      }

      // Detect orphaned mission: configured scenarioId no longer available.
      let orphanedMission: { scenarioId: string; name: string | null } | null = null;
      const configData = deps.configSync
        ? await deps.configSync.getLiveConfig(server).catch(() => null)
        : null;
      const scenarioId = configData?.scenarioId ?? null;

      if (scenarioId) {
        const knownScenarioIds = new Set([DEFAULT_SCENARIO_ID]);
        const scenarioLookupComplete = details.every((result) => result.status === 'fulfilled');
        for (const result of details) {
          if (result.status === 'fulfilled') {
            const mod = result.value;
            if (!hasScenarioTag(mod.tags)) continue;
            for (const s of mod.scenarios) {
              knownScenarioIds.add(s.scenarioId);
            }
          }
        }
        if (scenarioLookupComplete && !knownScenarioIds.has(scenarioId)) {
          orphanedMission = {
            scenarioId,
            name: null,
          };
        }
      }

      res.json({
        modsWithMissingVersions,
        modsWithMissingDeps,
        orphanedMission,
        checkedAt: new Date().toISOString(),
      });
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
