import type {
  ModOverviewEntry,
  ModResolveResponse,
  ModsOverviewResponse,
  ModWorkshopInfo,
  ReforgerConfigMod,
  ResolvedMod,
  ServerModsResponse,
  UpdateModsResult,
  WorkshopDependency,
  WorkshopModDetail,
} from '@reforger-panel/shared';
import { ApiError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { OFFICIAL_SCENARIO_IDS } from '../reforger-logs/missions-catalog.js';
import type { WorkshopCache } from '../workshop/workshop-cache.js';
import type { ServerRecord } from '../servers/server-service.js';
import { asRecord, type ConfigFileGateway } from './config-file-gateway.js';
import { readAtPath } from './config-tree.js';

/**
 * How long the overview waits for cold Workshop lookups before answering with
 * what it has. A large modlist on a cold cache cannot be resolved inside one
 * request without either blocking for a minute or tripping the upstream rate
 * limit, so the response is returned immediately with `warming: true` and the
 * client refetches while the background fill completes.
 */
const WARM_WAIT_MS = 2_500;

/** Guard against a pathological dependency graph. */
const MAX_RESOLVED_MODS = 400;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function readMods(root: Record<string, unknown>): ReforgerConfigMod[] {
  const game = asRecord(root.game);
  if (!game || !Array.isArray(game.mods)) return [];
  return game.mods
    .map((entry): ReforgerConfigMod | null => {
      const mod = asRecord(entry);
      const modId = typeof mod?.modId === 'string' ? mod.modId : '';
      if (!modId) return null;
      const name = typeof mod?.name === 'string' && mod.name ? mod.name : undefined;
      const version = typeof mod?.version === 'string' && mod.version ? mod.version : undefined;
      return {
        modId,
        ...(name ? { name } : {}),
        ...(version ? { version } : {}),
      };
    })
    .filter((mod): mod is ReforgerConfigMod => mod !== null);
}

function toWorkshopInfo(detail: WorkshopModDetail): ModWorkshopInfo {
  return {
    name: detail.name,
    author: detail.author,
    summary: detail.summary,
    imageUrl: detail.imageUrl,
    workshopUrl: detail.workshopUrl,
    latestVersion: detail.version,
    gameVersion: detail.gameVersion,
    sizeBytes: detail.sizeBytes,
    scenarioCount: detail.scenarioCount,
    dependencyCount: detail.dependencyCount,
    obsolete: detail.obsolete,
    tags: detail.tags,
  };
}

/**
 * Owns the `game.mods` array of the server's real config.json, and joins it
 * with Workshop metadata so the panel can show versions, sizes, dependencies
 * and available updates without the browser making one request per mod.
 */
export class ServerModsService {
  constructor(
    private readonly gateway: ConfigFileGateway,
    private readonly workshop: WorkshopCache,
    private readonly logger: Logger,
  ) {}

  private providerId(server: ServerRecord): string {
    return server.pterodactylServerId ?? server.slug;
  }

  async getMods(server: ServerRecord): Promise<ServerModsResponse> {
    const document = await this.gateway.download(this.providerId(server));
    const mods = readMods(document.root);
    // Keep the cache aligned with what is actually installed.
    this.workshop.warm(mods.map((mod) => mod.modId));
    return { mods, revision: document.revision, fetchedAt: new Date().toISOString() };
  }

  /**
   * Everything the Mods page needs in one request: installed mods joined with
   * cached Workshop metadata, update availability, dependency gaps and the
   * reverse "required by" edges that make removals safe.
   */
  async getOverview(server: ServerRecord): Promise<ModsOverviewResponse> {
    const document = await this.gateway.download(this.providerId(server));
    const installed = readMods(document.root);
    const ids = installed.map((mod) => mod.modId.toUpperCase());
    const installedIds = new Set(ids);

    // Start every lookup, then answer with whatever resolved in time.
    await Promise.race([
      Promise.allSettled(ids.map((id) => this.workshop.tryGetMod(id))),
      delay(WARM_WAIT_MS),
    ]);

    const details = new Map<string, WorkshopModDetail | null | undefined>();
    for (const id of ids) details.set(id, this.workshop.peekMod(id));

    // Reverse dependency edges: which installed mods need each mod.
    const requiredBy = new Map<string, string[]>();
    for (const [id, detail] of details) {
      if (!detail) continue;
      for (const dependency of detail.dependencies) {
        const dependents = requiredBy.get(dependency.id) ?? [];
        dependents.push(id);
        requiredBy.set(dependency.id, dependents);
      }
    }

    const unresolvedIds: string[] = [];
    let warming = false;
    let totalSizeBytes: number | null = null;
    let updatesAvailable = 0;

    const mods: ModOverviewEntry[] = installed.map((mod) => {
      const id = mod.modId.toUpperCase();
      const detail = details.get(id);
      if (detail === undefined) warming = true;
      if (detail === null) unresolvedIds.push(id);

      const pinnedVersion = mod.version ?? null;
      const workshop = detail ? toWorkshopInfo(detail) : null;
      const updateAvailable = Boolean(
        pinnedVersion && workshop?.latestVersion && pinnedVersion !== workshop.latestVersion,
      );
      if (updateAvailable) updatesAvailable += 1;
      if (workshop?.sizeBytes) totalSizeBytes = (totalSizeBytes ?? 0) + workshop.sizeBytes;

      const missingDependencies: WorkshopDependency[] = (detail?.dependencies ?? []).filter(
        (dependency) => !installedIds.has(dependency.id),
      );

      return {
        modId: id,
        configName: mod.name ?? null,
        pinnedVersion,
        workshop,
        updateAvailable,
        missingDependencies,
        requiredBy: (requiredBy.get(id) ?? []).filter((dependent) => dependent !== id),
      };
    });

    return {
      mods,
      revision: document.revision,
      fetchedAt: new Date().toISOString(),
      totalSizeBytes,
      updatesAvailable,
      unresolvedIds,
      warming,
      orphanedMission: this.detectOrphanedMission(document.root, details, warming),
    };
  }

  /**
   * Flags a configured scenario that nothing installed can provide — the usual
   * cause of a server that boots to the wrong mission after a mod removal.
   * Only reported once every mod resolved, so a warming cache never produces a
   * false alarm.
   */
  private detectOrphanedMission(
    root: Record<string, unknown>,
    details: Map<string, WorkshopModDetail | null | undefined>,
    warming: boolean,
  ): { scenarioId: string } | null {
    if (warming) return null;
    const scenarioId = readAtPath(root, 'game.scenarioId');
    if (typeof scenarioId !== 'string' || !scenarioId) return null;
    if (OFFICIAL_SCENARIO_IDS.has(scenarioId)) return null;
    for (const detail of details.values()) {
      if (!detail) return null; // an unresolved mod might well provide it
      if (detail.scenarios.some((scenario) => scenario.scenarioId === scenarioId)) return null;
    }
    return { scenarioId };
  }

  /**
   * Expands a desired mod list into everything needed to make it load: the
   * requested mods plus the transitive dependency closure, with sizes so the
   * UI can show the download cost before anything is written.
   */
  async resolve(desired: readonly ReforgerConfigMod[]): Promise<ModResolveResponse> {
    const requested = new Map<string, ReforgerConfigMod>();
    for (const mod of desired) requested.set(mod.modId.toUpperCase(), mod);

    const resolved = new Map<string, ResolvedMod>();
    const unresolvedIds: string[] = [];
    const queue = [...requested.keys()];
    const seen = new Set(queue);

    for (const id of queue) {
      const mod = requested.get(id);
      resolved.set(id, {
        modId: id,
        name: mod?.name ?? null,
        version: mod?.version ?? null,
        sizeBytes: null,
        viaDependency: false,
        requiredBy: [],
      });
    }

    while (queue.length > 0 && resolved.size < MAX_RESOLVED_MODS) {
      // Resolve a whole level at a time so the pacer can overlap requests.
      const level = queue.splice(0, queue.length);
      const details = await Promise.all(level.map((id) => this.workshop.tryGetMod(id)));

      for (let index = 0; index < level.length; index += 1) {
        const id = level[index]!;
        const detail = details[index] ?? null;
        const entry = resolved.get(id)!;

        if (!detail) {
          unresolvedIds.push(id);
          continue;
        }
        entry.name = entry.name ?? detail.name;
        entry.sizeBytes = detail.sizeBytes;

        for (const dependency of detail.dependencies) {
          const existing = resolved.get(dependency.id);
          if (existing) {
            if (!existing.requiredBy.includes(id)) existing.requiredBy.push(id);
            continue;
          }
          resolved.set(dependency.id, {
            modId: dependency.id,
            name: dependency.name,
            version: null,
            sizeBytes: dependency.sizeBytes,
            viaDependency: true,
            requiredBy: [id],
          });
          if (!seen.has(dependency.id)) {
            seen.add(dependency.id);
            queue.push(dependency.id);
          }
        }
      }
    }

    const mods = [...resolved.values()];
    const sized = mods.filter((mod) => mod.sizeBytes !== null);
    return {
      mods,
      addedDependencies: mods.filter((mod) => mod.viaDependency),
      totalSizeBytes:
        sized.length > 0 ? sized.reduce((sum, mod) => sum + (mod.sizeBytes ?? 0), 0) : null,
      unresolvedIds,
    };
  }

  /**
   * Writes the mod list. `expectedRevision` is required in practice: it is how
   * a stale browser tab is stopped from reverting somebody else's change.
   */
  async setMods(
    server: ServerRecord,
    mods: readonly ReforgerConfigMod[],
    expectedRevision?: string,
  ): Promise<UpdateModsResult> {
    const providerId = this.providerId(server);
    const before = await this.gateway.download(providerId);
    const previous = readMods(before.root);

    const previousById = new Map(previous.map((mod) => [mod.modId.toUpperCase(), mod]));
    const nextById = new Map(mods.map((mod) => [mod.modId.toUpperCase(), mod]));

    const added = [...nextById.keys()].filter((id) => !previousById.has(id)).length;
    const removed = [...previousById.keys()].filter((id) => !nextById.has(id)).length;
    const changed = [...nextById].filter(([id, mod]) => {
      const existing = previousById.get(id);
      return existing !== undefined && (existing.version ?? null) !== (mod.version ?? null);
    }).length;

    const normalized = [...nextById.entries()].map(([id, mod]) => ({
      modId: id,
      ...(mod.name ? { name: mod.name } : {}),
      ...(mod.version ? { version: mod.version } : {}),
    }));
    const expectedIds = [...nextById.keys()].sort();

    const document = await this.gateway.mutate(providerId, {
      expectedRevision: expectedRevision ?? before.revision,
      apply: (root) => {
        const game = asRecord(root.game)!;
        game.mods = normalized;
      },
      verify: (readBack) => {
        const actual = readMods(readBack)
          .map((mod) => mod.modId.toUpperCase())
          .sort();
        if (JSON.stringify(actual) !== JSON.stringify(expectedIds)) {
          throw ApiError.upstream(
            'Config write verification failed — the file on the server does not match. Check config.json.bak.',
          );
        }
      },
    });

    const result = readMods(document.root);
    this.workshop.warm(result.map((mod) => mod.modId));

    this.logger.info({ serverId: server.id, added, removed, changed }, 'server mods updated');
    return {
      mods: result,
      revision: document.revision,
      fetchedAt: new Date().toISOString(),
      added,
      removed,
      changed,
      requiresRestart: true,
    };
  }
}
