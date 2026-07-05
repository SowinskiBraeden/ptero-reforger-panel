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
        scenarioID: z.string(),
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
  };
}

const IMAGE_CACHE_TTL_MS = 60 * 60 * 1000; // matches upstream's 1 h detail cache
const IMAGE_FETCH_CONCURRENCY = 5;

export class WorkshopClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  /** modId → real image URL (or null when the mod has none). */
  private imageCache = new Map<string, { url: string | null; expiresAt: number }>();

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
    this.applyCachedImages(mods);
    void this.enrichImages(mods).catch(() => undefined);
    return {
      mods,
      meta: parsed.data.meta,
    };
  }

  private applyCachedImages(mods: WorkshopModPreview[]): void {
    const now = Date.now();
    for (const mod of mods) {
      if (mod.imageUrl) continue;
      const cached = this.imageCache.get(mod.id);
      if (cached && cached.expiresAt > now) {
        mod.imageUrl = cached.url;
      }
    }
  }

  /**
   * List responses carry no usable images, so fill them in from the detail
   * endpoint (which does). This runs as a background cache warmer from search:
   * first-load results are fast, later visits pick up cached images.
   */
  private async enrichImages(mods: WorkshopModPreview[]): Promise<void> {
    const now = Date.now();
    const pending: WorkshopModPreview[] = [];
    for (const mod of mods) {
      if (mod.imageUrl) continue;
      const cached = this.imageCache.get(mod.id);
      if (cached && cached.expiresAt > now) {
        mod.imageUrl = cached.url;
      } else {
        pending.push(mod);
      }
    }
    if (pending.length === 0) return;

    const queue = [...pending];
    const worker = async () => {
      for (;;) {
        const mod = queue.shift();
        if (!mod) return;
        try {
          const detail = await this.getMod(mod.id);
          mod.imageUrl = detail.imageUrl;
        } catch {
          mod.imageUrl = null;
        }
        this.imageCache.set(mod.id, {
          url: mod.imageUrl,
          expiresAt: Date.now() + IMAGE_CACHE_TTL_MS,
        });
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(IMAGE_FETCH_CONCURRENCY, queue.length) }, () => worker()),
    );
    if (this.imageCache.size > 5_000) {
      for (const [key, value] of this.imageCache) {
        if (value.expiresAt <= now) this.imageCache.delete(key);
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
    return {
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
        scenarioId: scenario.scenarioID,
        gamemode: scenario.gamemode || null,
        playerCount: scenario.playerCount || null,
        imageUrl: normalizeImageUrl(scenario.imageURL),
      })),
    };
  }
}
