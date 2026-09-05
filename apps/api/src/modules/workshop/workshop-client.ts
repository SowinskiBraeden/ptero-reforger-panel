import { z } from 'zod';
import type {
  WorkshopDependency,
  WorkshopModDetail,
  WorkshopModPreview,
  WorkshopModVersion,
  WorkshopModVersionsResponse,
  WorkshopScenario,
  WorkshopSearchResponse,
  WorkshopServerModsResponse,
  WorkshopServerSearchResponse,
  WorkshopServerSummary,
  WorkshopSort,
} from '@reforger-panel/shared';
import { ApiError } from '../../lib/errors.js';

/**
 * Client for the reforgermods.net Workshop metadata API, v2.
 * Endpoint shapes follow https://reforgermods.net/arma-reforger-mods-api/v2/:
 *   GET /v2/mods?page&search&sort&tags&category
 *   GET /v2/mods/{id}
 *   GET /v2/mods/{id}/versions
 *   GET /v2/mods/{id}/dependencies
 *   GET /v2/mods/{id}/scenarios
 *   GET /v2/servers?search&hasMods&perPage
 *   GET /v2/servers/{id}/mods
 *
 * v2 returns typed values (byte counts, numeric ratings) and real scenario ids,
 * so none of v1's string parsing is needed here. Backend-only — the browser
 * never talks to this host directly. Caching and request pacing live in
 * WorkshopCache; this class is a thin typed transport.
 */

/** Identifies the panel to the upstream, as its docs request. */
const CLIENT_NAME = 'reforger-panel';

// ---------- upstream schemas ----------

const modPreviewSchema = z.object({
  id: z.string(),
  name: z.string().catch('Unknown mod'),
  summary: z.string().nullish(),
  author: z.string().catch('Unknown'),
  version: z.string().nullish(),
  gameVersion: z.string().nullish(),
  size: z.number().nullish(),
  sizeFormatted: z.string().nullish(),
  rating: z.number().nullish(),
  ratingCount: z.number().nullish(),
  subscriberCount: z.number().nullish(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
  obsolete: z.boolean().nullish(),
  tags: z.array(z.string()).catch([]),
  imageUrl: z.string().nullish(),
  workshopUrl: z.string().nullish(),
});

const searchResponseSchema = z.object({
  meta: z
    .object({
      totalPages: z.number().catch(1),
      currentPage: z.number().catch(1),
      totalMods: z.number().catch(0),
    })
    .catch({ totalPages: 1, currentPage: 1, totalMods: 0 }),
  data: z.array(modPreviewSchema).catch([]),
});

const dependencySchema = z.object({
  id: z.string(),
  name: z.string().catch('Unknown mod'),
  version: z.string().nullish(),
  size: z.number().nullish(),
  published: z.boolean().nullish(),
  private: z.boolean().nullish(),
});

const scenarioSchema = z.object({
  name: z.string().catch('Unnamed scenario'),
  gameId: z.string().nullish(),
  gameMode: z.string().nullish(),
  author: z.string().nullish(),
  description: z.string().nullish(),
  playerCount: z.number().nullish(),
});

const modDetailSchema = modPreviewSchema.extend({
  description: z.string().nullish(),
  license: z.string().nullish(),
  downloadCount: z.number().nullish(),
  previewImages: z.array(z.string()).catch([]),
  screenshots: z.array(z.string()).catch([]),
  versionCount: z.number().nullish(),
  dependencyCount: z.number().nullish(),
  scenarioCount: z.number().nullish(),
  dependencySize: z.number().nullish(),
  totalSize: z.number().nullish(),
  dependencies: z.array(dependencySchema).catch([]),
  scenarios: z.array(scenarioSchema).catch([]),
});

const modDetailEnvelopeSchema = z.object({ mod: modDetailSchema });

const versionSchema = z.object({
  version: z.string(),
  gameVersion: z.string().nullish(),
  size: z.number().nullish(),
  sizeFormatted: z.string().nullish(),
  approved: z.boolean().nullish(),
  published: z.boolean().nullish(),
  createdAt: z.string().nullish(),
  scenarioCount: z.number().nullish(),
  dependencyCount: z.number().nullish(),
});

const versionsEnvelopeSchema = z.object({
  data: z.object({
    modId: z.string().catch(''),
    versions: z.array(versionSchema).catch([]),
  }),
});

const dependenciesEnvelopeSchema = z.object({
  data: z.object({
    dependencies: z.array(dependencySchema).catch([]),
  }),
});

const scenariosEnvelopeSchema = z.object({
  data: z.object({
    scenarios: z.array(scenarioSchema).catch([]),
  }),
});

const serverSummarySchema = z.object({
  id: z.string(),
  name: z.string().catch('Unnamed server'),
  scenarioId: z.string().nullish(),
  scenarioName: z.string().nullish(),
  gameVersion: z.string().nullish(),
  players: z.number().catch(0),
  maxPlayers: z.number().catch(0),
  region: z.string().nullish(),
  platform: z.string().nullish(),
  modCount: z.number().catch(0),
  official: z.boolean().nullish(),
  online: z.boolean().nullish(),
});

const serverSearchEnvelopeSchema = z.object({
  meta: z
    .object({
      totalPages: z.number().catch(1),
      currentPage: z.number().catch(1),
      totalServers: z.number().catch(0),
    })
    .catch({ totalPages: 1, currentPage: 1, totalServers: 0 }),
  data: z.array(serverSummarySchema).catch([]),
});

const serverModsEnvelopeSchema = z.object({
  serverId: z.string().catch(''),
  summary: z
    .object({
      knownSize: z.number().nullish(),
      unresolvedCount: z.number().nullish(),
    })
    .nullish(),
  data: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().catch('Unknown mod'),
        version: z.string().nullish(),
        size: z.number().nullish(),
      }),
    )
    .catch([]),
});

// ---------- normalisation helpers ----------

/**
 * Upstream image URLs still need repair: list endpoints occasionally return
 * dead via.placeholder.com stubs, and some rows concatenate two URLs
 * ("https://reforger.armaplatform.comhttps://ar-gcp-cdn...").
 */
export function normalizeImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.includes('via.placeholder.com')) return null;
  const lastScheme = raw.lastIndexOf('https://');
  const candidate = lastScheme > 0 ? raw.slice(lastScheme) : raw;
  return candidate.startsWith('http') ? candidate : null;
}

/** Upstream reports 0 for "size unknown"; keep that distinct from "0 bytes". */
function sizeOrNull(size: number | null | undefined): number | null {
  return typeof size === 'number' && size > 0 ? size : null;
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toPreview(mod: z.infer<typeof modPreviewSchema>): WorkshopModPreview {
  return {
    id: mod.id,
    name: mod.name,
    author: mod.author,
    summary: text(mod.summary),
    imageUrl: normalizeImageUrl(mod.imageUrl),
    workshopUrl: text(mod.workshopUrl),
    version: text(mod.version),
    gameVersion: text(mod.gameVersion),
    sizeBytes: sizeOrNull(mod.size),
    sizeText: text(mod.sizeFormatted),
    rating: typeof mod.rating === 'number' ? mod.rating : null,
    ratingCount: mod.ratingCount ?? null,
    subscriberCount: mod.subscriberCount ?? null,
    createdAt: text(mod.createdAt),
    updatedAt: text(mod.updatedAt),
    tags: mod.tags,
    obsolete: mod.obsolete ?? false,
  };
}

function toDependency(dep: z.infer<typeof dependencySchema>): WorkshopDependency {
  return {
    id: dep.id.toUpperCase(),
    name: dep.name,
    version: text(dep.version),
    sizeBytes: sizeOrNull(dep.size),
    published: dep.published ?? true,
    private: dep.private ?? false,
  };
}

/**
 * Scenario `gameMode` / `description` are Enfusion localization keys such as
 * `#AR-Scenario_GameMode_Campaign`. Map the ones that show up in practice and
 * fall back to a readable form of the key rather than leaking `#AR-` at users.
 */
const GAME_MODE_LABELS: Record<string, string> = {
  '#AR-Scenario_GameMode_Campaign': 'Campaign',
  '#AR-Scenario_GameMode_Conflict': 'Conflict',
  '#AR-Scenario_GameMode_CombatOps': 'Combat Ops',
  '#AR-Scenario_GameMode_GameMaster': 'Game Master',
  '#AR-Scenario_GameMode_Tutorial': 'Tutorial',
  '#AR-ServerBrowser_ServerScenario': 'Scenario',
  '#AR-Campaign_GamemodeDesc': 'Campaign',
  '#AR-CombatScenario_Description': 'Combat Ops',
};

export function localizedLabel(value: string | null | undefined): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (!raw.startsWith('#')) return raw;
  const mapped = GAME_MODE_LABELS[raw];
  if (mapped) return mapped;
  // "#AR-Scenario_GameMode_FooBar" -> "Foo Bar"
  const tail =
    raw
      .replace(/^#[A-Za-z]+-/, '')
      .split('_')
      .pop() ?? raw;
  const spaced = tail.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  return spaced || null;
}

function toScenario(scenario: z.infer<typeof scenarioSchema>): WorkshopScenario | null {
  const scenarioId = text(scenario.gameId);
  if (!scenarioId) return null;
  return {
    scenarioId,
    name: scenario.name,
    gameMode: localizedLabel(scenario.gameMode),
    author: localizedLabel(scenario.author),
    description: localizedLabel(scenario.description),
    playerCount: scenario.playerCount && scenario.playerCount > 0 ? scenario.playerCount : null,
  };
}

function toVersion(version: z.infer<typeof versionSchema>): WorkshopModVersion {
  return {
    version: version.version,
    gameVersion: text(version.gameVersion),
    sizeBytes: sizeOrNull(version.size),
    sizeText: text(version.sizeFormatted),
    approved: version.approved ?? true,
    published: version.published ?? true,
    createdAt: text(version.createdAt),
    scenarioCount: version.scenarioCount ?? null,
    dependencyCount: version.dependencyCount ?? null,
  };
}

function toServerSummary(server: z.infer<typeof serverSummarySchema>): WorkshopServerSummary {
  return {
    id: server.id,
    name: server.name,
    scenarioId: text(server.scenarioId),
    scenarioName: text(server.scenarioName),
    gameVersion: text(server.gameVersion),
    players: server.players,
    maxPlayers: server.maxPlayers,
    region: text(server.region),
    platform: text(server.platform),
    modCount: server.modCount,
    official: server.official ?? false,
    online: server.online ?? true,
  };
}

export type WorkshopSearchParams = {
  query?: string;
  page?: number;
  sort?: WorkshopSort;
  /** Upstream accepts a single tag only; comma-separated values are rejected. */
  tag?: string;
  category?: string;
};

export class WorkshopClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly apiKey: string;

  constructor(options: {
    baseUrl: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    apiKey?: string;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.apiKey = options.apiKey ?? '';
  }

  private async get(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: {
          Accept: 'application/json',
          'X-API-Client': CLIENT_NAME,
          'User-Agent': CLIENT_NAME,
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'failed';
      throw ApiError.upstream(`Workshop API request ${reason}.`);
    }
    if (response.status === 404) {
      throw ApiError.notFound('Workshop mod not found.');
    }
    if (response.status === 429) {
      throw ApiError.rateLimited('Workshop API rate limit reached. Try again shortly.');
    }
    if (!response.ok) {
      throw ApiError.upstream(`Workshop API returned HTTP ${response.status}.`);
    }
    return response.json();
  }

  private parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw ApiError.upstream('Workshop API returned an unexpected response shape.');
    }
    return parsed.data;
  }

  async search(params: WorkshopSearchParams = {}): Promise<WorkshopSearchResponse> {
    const search = new URLSearchParams();
    search.set('page', String(Math.max(1, params.page ?? 1)));
    if (params.query) search.set('search', params.query);
    if (params.sort) search.set('sort', params.sort);
    if (params.tag) search.set('tags', params.tag);
    if (params.category) search.set('category', params.category);
    const parsed = this.parse(searchResponseSchema, await this.get(`/v2/mods?${search}`));
    return { mods: parsed.data.map(toPreview), meta: parsed.meta };
  }

  async getMod(modId: string): Promise<WorkshopModDetail> {
    const raw = await this.get(`/v2/mods/${encodeURIComponent(modId)}`);
    const { mod } = this.parse(modDetailEnvelopeSchema, raw);
    return {
      ...toPreview(mod),
      description: text(mod.description),
      license: text(mod.license),
      downloadCount: mod.downloadCount ?? null,
      previewImages: mod.previewImages
        .map(normalizeImageUrl)
        .filter((url): url is string => url !== null),
      screenshots: mod.screenshots
        .map(normalizeImageUrl)
        .filter((url): url is string => url !== null),
      versionCount: mod.versionCount ?? null,
      dependencyCount: mod.dependencyCount ?? mod.dependencies.length,
      scenarioCount: mod.scenarioCount ?? mod.scenarios.length,
      dependencySizeBytes: sizeOrNull(mod.dependencySize),
      totalSizeBytes: sizeOrNull(mod.totalSize),
      dependencies: mod.dependencies.map(toDependency),
      scenarios: mod.scenarios
        .map(toScenario)
        .filter((scenario): scenario is WorkshopScenario => scenario !== null),
    };
  }

  async getVersions(modId: string): Promise<WorkshopModVersionsResponse> {
    const raw = await this.get(`/v2/mods/${encodeURIComponent(modId)}/versions`);
    const { data } = this.parse(versionsEnvelopeSchema, raw);
    return { modId: data.modId || modId, versions: data.versions.map(toVersion) };
  }

  async getDependencies(modId: string): Promise<WorkshopDependency[]> {
    const raw = await this.get(`/v2/mods/${encodeURIComponent(modId)}/dependencies`);
    const { data } = this.parse(dependenciesEnvelopeSchema, raw);
    return data.dependencies.map(toDependency);
  }

  async getScenarios(modId: string): Promise<WorkshopScenario[]> {
    const raw = await this.get(`/v2/mods/${encodeURIComponent(modId)}/scenarios`);
    const { data } = this.parse(scenariosEnvelopeSchema, raw);
    return data.scenarios
      .map(toScenario)
      .filter((scenario): scenario is WorkshopScenario => scenario !== null);
  }

  async searchServers(query: string, page = 1): Promise<WorkshopServerSearchResponse> {
    const search = new URLSearchParams({
      page: String(Math.max(1, page)),
      perPage: '25',
      hasMods: 'true',
      sort: 'players',
    });
    if (query) search.set('search', query);
    const parsed = this.parse(serverSearchEnvelopeSchema, await this.get(`/v2/servers?${search}`));
    return { servers: parsed.data.map(toServerSummary), meta: parsed.meta };
  }

  async getServerMods(serverId: string): Promise<WorkshopServerModsResponse> {
    const raw = await this.get(`/v2/servers/${encodeURIComponent(serverId)}/mods?sizes=true`);
    const parsed = this.parse(serverModsEnvelopeSchema, raw);
    return {
      serverId: parsed.serverId || serverId,
      mods: parsed.data.map((mod) => ({
        id: mod.id.toUpperCase(),
        name: mod.name,
        version: text(mod.version),
        sizeBytes: sizeOrNull(mod.size),
      })),
      knownSizeBytes: sizeOrNull(parsed.summary?.knownSize),
      unresolvedCount: parsed.summary?.unresolvedCount ?? 0,
    };
  }
}
