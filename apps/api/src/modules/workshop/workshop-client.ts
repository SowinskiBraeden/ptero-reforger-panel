import { z } from 'zod';
import type {
  WorkshopHealth,
  WorkshopModDetail,
  WorkshopModPreview,
  WorkshopSearchResponse,
} from '@reforger-panel/shared';
import { ApiError } from '../../lib/errors.js';
import { sanitizeErrorMessage } from '../../lib/logger.js';

/**
 * Client for the public reforgermods.net Workshop metadata API.
 * Endpoint shapes follow https://reforgermods.net/?page=documentation/api:
 *   GET /v1/health
 *   GET /v1/mods/{page}?search={q}&sort={sort}
 *   GET /v1/mod/{mod_id}
 * Backend-only — the browser never talks to this host directly.
 */

const modPreviewSchema = z.object({
  name: z.string(),
  author: z.string().catch('Unknown'),
  imageURL: z.string().catch(''),
  originalModURL: z.string().catch(''),
  size: z.string().catch(''),
  rating: z.string().catch(''),
  ID: z.string(),
  version: z.string().nullish(),
  summary: z.string().nullish(),
  tags: z.array(z.string()).catch([]),
});

const searchResponseSchema = z.object({
  status: z.string(),
  meta: z.object({
    totalPages: z.number().catch(1),
    currentPage: z.number().catch(1),
    totalMods: z.number().catch(0),
  }),
  data: z.array(modPreviewSchema).catch([]),
});

const modDetailSchema = z.object({
  name: z.string(),
  author: z.string().catch('Unknown'),
  originalModURL: z.string().catch(''),
  imageURL: z.string().catch(''),
  rating: z.string().catch(''),
  version: z.string().nullish(),
  gameVersion: z.string().nullish(),
  size: z.string().catch(''),
  subscribers: z.number().nullish(),
  downloads: z.number().nullish(),
  created: z.string().nullish(),
  lastModified: z.string().nullish(),
  id: z.string(),
  summary: z.string().nullish(),
  description: z.string().nullish(),
  license: z.string().nullish(),
  tags: z.array(z.string()).catch([]),
  dependencies: z.array(z.object({ name: z.string(), apiModURL: z.string().catch('') })).catch([]),
  scenarios: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().catch(''),
        scenarioID: z.string().catch(''),
        gamemode: z.string().catch(''),
        playerCount: z.number().catch(0),
        imageURL: z.string().catch(''),
      }),
    )
    .catch([]),
});

const modDetailEnvelopeSchema = z.object({ status: z.string(), mod: modDetailSchema });

export type WorkshopSort = 'popularity' | 'newest' | 'subscribers' | 'version_size';

function extractModId(apiModUrl: string): string | null {
  const match = /\/v1\/mod\/([^/?#]+)/.exec(apiModUrl);
  return match?.[1] ?? null;
}

const SCENARIO_ID_PATTERN = /(\{[0-9a-fA-F]{16}\}[^\s,;)]*?\.conf)/;
const SCENARIO_ID_WITH_LABEL_PATTERN =
  /scenario\s*id\s*:?\s*\{[0-9a-fA-F]{16}\}[^\s,;)]*?\.conf/i;

function extractScenarioId(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const match = value?.match(SCENARIO_ID_PATTERN);
    if (match?.[1]) return match[1];
  }
  return '';
}

function cleanScenarioText(value: string | null | undefined): string | null {
  const cleaned = value?.replace(SCENARIO_ID_WITH_LABEL_PATTERN, '').trim();
  return cleaned || null;
}

/**
 * Upstream image URLs need repair: list endpoints return dead
 * via.placeholder.com stubs, and detail endpoints sometimes concatenate two
 * URLs ("https://reforger.armaplatform.comhttps://ar-gcp-cdn...").
 */
export function normalizeImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.includes('via.placeholder.com')) return null;
  const lastScheme = raw.lastIndexOf('https://');
  const candidate = lastScheme > 0 ? raw.slice(lastScheme) : raw;
  return candidate.startsWith('http') ? candidate : null;
}

function toPreview(mod: z.infer<typeof modPreviewSchema>): WorkshopModPreview {
  return {
    id: mod.ID,
    name: mod.name,
    author: mod.author,
    imageUrl: normalizeImageUrl(mod.imageURL),
    size: mod.size || null,
    rating: mod.rating || null,
    workshopUrl: mod.originalModURL || null,
    version: mod.version ?? null,
    summary: mod.summary ?? null,
    tags: mod.tags,
  };
}

const PREVIEW_CACHE_TTL_MS = 60 * 60 * 1000; // matches upstream's 1 h detail cache

export class WorkshopClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  /** modId -> detail fields used to make browse cards useful. */
  private previewCache = new Map<
    string,
    {
      imageUrl: string | null;
      version: string | null;
      summary: string | null;
      tags: string[];
      expiresAt: number;
    }
  >();

  constructor(options: { baseUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  private async get(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { Accept: 'application/json' },
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

  async health(): Promise<WorkshopHealth> {
    const startedAt = Date.now();
    try {
      await this.get('/v1/health');
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
        message: null,
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: null,
        checkedAt: new Date().toISOString(),
        message: sanitizeErrorMessage(error),
      };
    }
  }

  async search(query: string, page = 1, sort?: WorkshopSort): Promise<WorkshopSearchResponse> {
    const params = new URLSearchParams();
    if (query) params.set('search', query);
    if (sort) params.set('sort', sort);
    const qs = params.size > 0 ? `?${params.toString()}` : '';
    const raw = await this.get(`/v1/mods/${Math.max(1, page)}${qs}`);
    const parsed = searchResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw ApiError.upstream('Workshop API returned an unexpected response shape.');
    }
    const mods = parsed.data.data.map(toPreview);
    this.applyCachedPreviews(mods);
    return {
      mods,
      meta: parsed.data.meta,
    };
  }

  private applyCachedPreviews(mods: WorkshopModPreview[]): void {
    const now = Date.now();
    for (const mod of mods) {
      const cached = this.previewCache.get(mod.id);
      if (cached && cached.expiresAt > now) {
        mod.imageUrl = mod.imageUrl ?? cached.imageUrl;
        mod.version = mod.version ?? cached.version;
        mod.summary = mod.summary ?? cached.summary;
        mod.tags = mod.tags.length > 0 ? mod.tags : cached.tags;
      }
    }
  }

  async getMod(modId: string): Promise<WorkshopModDetail> {
    const raw = await this.get(`/v1/mod/${encodeURIComponent(modId)}`);
    const parsed = modDetailEnvelopeSchema.safeParse(raw);
    if (!parsed.success) {
      throw ApiError.upstream('Workshop API returned an unexpected response shape.');
    }
    const mod = parsed.data.mod;
    const detail = {
      id: mod.id,
      name: mod.name,
      author: mod.author,
      imageUrl: normalizeImageUrl(mod.imageURL),
      size: mod.size || null,
      rating: mod.rating || null,
      workshopUrl: mod.originalModURL || null,
      version: mod.version ?? null,
      gameVersion: mod.gameVersion ?? null,
      subscribers: mod.subscribers ?? null,
      downloads: mod.downloads ?? null,
      createdAtText: mod.created ?? null,
      lastModifiedText: mod.lastModified ?? null,
      summary: mod.summary ?? null,
      description: mod.description ?? null,
      license: mod.license ?? null,
      tags: mod.tags,
      dependencies: mod.dependencies.map((dep) => ({
        name: dep.name,
        id: extractModId(dep.apiModURL),
      })),
      scenarios: mod.scenarios.map((scenario) => ({
        name: scenario.name,
        description: scenario.description || null,
        scenarioId: extractScenarioId(
          scenario.scenarioID,
          scenario.gamemode,
          scenario.description,
          scenario.name,
        ),
        gamemode: cleanScenarioText(scenario.gamemode),
        playerCount: scenario.playerCount || null,
        imageUrl: normalizeImageUrl(scenario.imageURL),
      })),
    };
    this.previewCache.set(detail.id, {
      imageUrl: detail.imageUrl,
      version: detail.version,
      summary: detail.summary ?? detail.description,
      tags: detail.tags,
      expiresAt: Date.now() + PREVIEW_CACHE_TTL_MS,
    });
    if (this.previewCache.size > 5_000) {
      const now = Date.now();
      for (const [key, value] of this.previewCache) {
        if (value.expiresAt <= now) this.previewCache.delete(key);
      }
    }
    return detail;
  }
}
