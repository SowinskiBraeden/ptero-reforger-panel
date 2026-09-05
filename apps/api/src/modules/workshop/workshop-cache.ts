import type {
  WorkshopDependency,
  WorkshopModDetail,
  WorkshopModVersionsResponse,
  WorkshopScenario,
  WorkshopSearchResponse,
  WorkshopServerModsResponse,
  WorkshopServerSearchResponse,
} from '@reforger-panel/shared';
import { ApiError } from '../../lib/errors.js';
import { sanitizeErrorMessage, type Logger } from '../../lib/logger.js';
import type { WorkshopClient, WorkshopSearchParams } from './workshop-client.js';

/**
 * TTLs mirror what reforgermods.net caches upstream, so we never ask more
 * often than the answer can change. `stale` is how long a value stays usable
 * while a refresh runs in the background.
 */
const TTL = {
  detail: { fresh: 60 * 60_000, stale: 24 * 60 * 60_000 },
  versions: { fresh: 6 * 60 * 60_000, stale: 7 * 24 * 60 * 60_000 },
  search: { fresh: 10 * 60_000, stale: 60 * 60_000 },
  servers: { fresh: 60_000, stale: 10 * 60_000 },
  /** How long a "this mod does not exist" answer is trusted. */
  negative: 10 * 60_000,
} as const;

/** After an upstream failure, fail fast for this long instead of retrying. */
const FAILURE_COOLDOWN_MS = 30_000;
const MAX_ENTRIES = 2_000;

type Entry = {
  value: unknown;
  /** True for a cached "not found" — value is null and must not be retried yet. */
  missing: boolean;
  freshUntil: number;
  staleUntil: number;
};

/**
 * Concurrency gate plus a token bucket. The free upstream tier allows 60
 * requests/minute per IP with a burst of 20; we deliberately sit under that so
 * the panel never trips a 429 and never has to throttle in the browser (which
 * is what the old client-side limiter in mods.tsx was doing).
 */
class RequestPacer {
  private active = 0;
  private tokens: number;
  private lastRefillAt = Date.now();
  private waiters: (() => void)[] = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly perMinute: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillAt;
    if (elapsed <= 0) return;
    this.lastRefillAt = now;
    this.tokens = Math.min(this.burst, this.tokens + (elapsed / 60_000) * this.perMinute);
  }

  private tryTake(): boolean {
    this.refill();
    if (this.active >= this.maxConcurrent || this.tokens < 1) return false;
    this.tokens -= 1;
    this.active += 1;
    return true;
  }

  private pump(): void {
    while (this.waiters.length > 0) {
      if (!this.tryTake()) {
        // Nothing available now; re-check when a token could have accrued.
        setTimeout(() => this.pump(), Math.ceil(60_000 / this.perMinute)).unref?.();
        return;
      }
      this.waiters.shift()!();
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (!this.tryTake()) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(() => this.pump(), 0).unref?.();
      });
    }
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.pump();
    }
  }
}

/**
 * Read-through cache over the Workshop API with stale-while-revalidate,
 * single-flight de-duplication and request pacing.
 *
 * This is what makes the Mods page fast: the installed-mod overview, the
 * mission list and the dependency check all hit the same warm entries instead
 * of each fanning out over the network, and a stale entry is served instantly
 * while it refreshes behind the request.
 */
export class WorkshopCache {
  private readonly store = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly failures = new Map<string, number>();
  private readonly pacer = new RequestPacer(6, 50, 15);

  constructor(
    private readonly client: WorkshopClient,
    private readonly logger: Logger,
  ) {}

  // ---------- cache primitives ----------

  private read(key: string): Entry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.staleUntil <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh LRU position.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry;
  }

  private write(key: string, value: unknown, ttl: { fresh: number; stale: number }): void {
    const now = Date.now();
    this.store.delete(key);
    this.store.set(key, {
      value,
      missing: false,
      freshUntil: now + ttl.fresh,
      staleUntil: now + ttl.stale,
    });
    this.evict();
  }

  private writeMissing(key: string): void {
    const now = Date.now();
    this.store.delete(key);
    this.store.set(key, {
      value: null,
      missing: true,
      freshUntil: now + TTL.negative,
      staleUntil: now + TTL.negative,
    });
    this.evict();
  }

  private evict(): void {
    while (this.store.size > MAX_ENTRIES) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
    }
  }

  /**
   * Runs `loader` once per key even if called concurrently, paced against the
   * upstream rate limit. A 404 is remembered as a negative entry; any other
   * failure starts a short cooldown so a flapping upstream cannot be hammered.
   */
  private async load<T>(
    key: string,
    ttl: { fresh: number; stale: number },
    loader: () => Promise<T>,
  ): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return (await existing) as T;

    const cooldownUntil = this.failures.get(key);
    if (cooldownUntil && cooldownUntil > Date.now()) {
      throw ApiError.upstream('Workshop API is temporarily unavailable.');
    }

    const promise = this.pacer
      .run(loader)
      .then((value) => {
        this.failures.delete(key);
        this.write(key, value, ttl);
        return value;
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.code === 'NOT_FOUND') {
          this.failures.delete(key);
          this.writeMissing(key);
          throw error;
        }
        this.failures.set(key, Date.now() + FAILURE_COOLDOWN_MS);
        throw error;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return (await promise) as T;
  }

  private async cached<T>(
    key: string,
    ttl: { fresh: number; stale: number },
    loader: () => Promise<T>,
  ): Promise<T> {
    const entry = this.read(key);
    if (entry?.missing) throw ApiError.notFound('Workshop mod not found.');
    if (entry) {
      if (entry.freshUntil > Date.now()) return entry.value as T;
      // Stale but usable: serve it now, refresh behind the caller's back.
      void this.load(key, ttl, loader).catch(() => undefined);
      return entry.value as T;
    }
    return this.load(key, ttl, loader);
  }

  // ---------- public API ----------

  /** Synchronous peek. `undefined` means "not cached", `null` means "known missing". */
  peekMod(modId: string): WorkshopModDetail | null | undefined {
    const entry = this.read(`mod:${modId.toUpperCase()}`);
    if (!entry) return undefined;
    return entry.missing ? null : (entry.value as WorkshopModDetail);
  }

  async getMod(modId: string): Promise<WorkshopModDetail> {
    const id = modId.toUpperCase();
    return this.cached(`mod:${id}`, TTL.detail, () => this.client.getMod(id));
  }

  /** Non-throwing variant for bulk paths that must tolerate missing mods. */
  async tryGetMod(modId: string): Promise<WorkshopModDetail | null> {
    return this.getMod(modId).catch(() => null);
  }

  async getVersions(modId: string): Promise<WorkshopModVersionsResponse> {
    const id = modId.toUpperCase();
    return this.cached(`versions:${id}`, TTL.versions, () => this.client.getVersions(id));
  }

  async getDependencies(modId: string): Promise<WorkshopDependency[]> {
    // The detail payload already carries dependencies, so reuse that entry
    // instead of spending a second upstream request on the same information.
    const detail = await this.tryGetMod(modId);
    if (detail) return detail.dependencies;
    const id = modId.toUpperCase();
    return this.cached(`deps:${id}`, TTL.detail, () => this.client.getDependencies(id));
  }

  async getScenarios(modId: string): Promise<WorkshopScenario[]> {
    const detail = await this.tryGetMod(modId);
    if (!detail) return [];
    // scenarioCount is authoritative; skip the request entirely for mods that
    // ship none (the old code used a tag heuristic that both over- and
    // under-matched).
    if (detail.scenarioCount === 0) return [];
    if (detail.scenarios.length > 0) return detail.scenarios;
    const id = modId.toUpperCase();
    return this.cached(`scenarios:${id}`, TTL.detail, () => this.client.getScenarios(id)).catch(
      () => [],
    );
  }

  async search(params: WorkshopSearchParams): Promise<WorkshopSearchResponse> {
    const key = `search:${params.query ?? ''}|${params.page ?? 1}|${params.sort ?? ''}|${
      params.tag ?? ''
    }|${params.category ?? ''}`;
    return this.cached(key, TTL.search, () => this.client.search(params));
  }

  async searchServers(query: string, page: number): Promise<WorkshopServerSearchResponse> {
    return this.cached(`servers:${query}|${page}`, TTL.servers, () =>
      this.client.searchServers(query, page),
    );
  }

  async getServerMods(serverId: string): Promise<WorkshopServerModsResponse> {
    return this.cached(`server-mods:${serverId}`, TTL.servers, () =>
      this.client.getServerMods(serverId),
    );
  }

  /**
   * Populates details for a set of mod ids in the background. Called at boot
   * with the installed mod list so the first Mods page open is already warm,
   * and after a mod list change so the new entries are ready.
   */
  warm(modIds: string[]): void {
    const cold = modIds.filter((id) => this.peekMod(id) === undefined);
    if (cold.length === 0) return;
    this.logger.debug({ count: cold.length }, 'warming workshop cache');
    void Promise.allSettled(cold.map((id) => this.tryGetMod(id))).then((results) => {
      const failed = results.filter((r) => r.status === 'fulfilled' && r.value === null).length;
      if (failed > 0) {
        this.logger.debug({ failed, total: cold.length }, 'workshop cache warm partially failed');
      }
    });
  }

  /** Drops cached entries so the next read goes upstream (explicit Refresh). */
  invalidate(modIds?: string[]): void {
    if (!modIds) {
      this.store.clear();
      this.failures.clear();
      return;
    }
    for (const modId of modIds) {
      const id = modId.toUpperCase();
      for (const prefix of ['mod', 'versions', 'deps', 'scenarios']) {
        this.store.delete(`${prefix}:${id}`);
        this.failures.delete(`${prefix}:${id}`);
      }
    }
  }

  /** Diagnostics for the settings page. */
  stats(): { entries: number; inflight: number; cooldowns: number } {
    return {
      entries: this.store.size,
      inflight: this.inflight.size,
      cooldowns: [...this.failures.values()].filter((until) => until > Date.now()).length,
    };
  }
}

export function describeWorkshopError(error: unknown): string {
  return sanitizeErrorMessage(error);
}
