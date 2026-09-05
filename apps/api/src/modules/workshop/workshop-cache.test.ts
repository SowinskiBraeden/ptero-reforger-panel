import { describe, expect, it, vi } from 'vitest';
import type { WorkshopModDetail } from '@reforger-panel/shared';
import { createLogger } from '../../lib/logger.js';
import { ApiError } from '../../lib/errors.js';
import { WorkshopCache } from './workshop-cache.js';
import type { WorkshopClient } from './workshop-client.js';

function detail(id: string, overrides: Partial<WorkshopModDetail> = {}): WorkshopModDetail {
  return {
    id,
    name: `Mod ${id}`,
    author: 'Author',
    summary: null,
    imageUrl: null,
    workshopUrl: null,
    version: '1.0.0',
    gameVersion: null,
    sizeBytes: 1024,
    sizeText: '1 KiB',
    rating: null,
    ratingCount: null,
    subscriberCount: null,
    createdAt: null,
    updatedAt: null,
    tags: [],
    obsolete: false,
    description: null,
    license: null,
    downloadCount: null,
    previewImages: [],
    screenshots: [],
    versionCount: 1,
    dependencyCount: 0,
    scenarioCount: 0,
    dependencySizeBytes: null,
    totalSizeBytes: null,
    dependencies: [],
    scenarios: [],
    ...overrides,
  };
}

function cacheWith(getMod: (id: string) => Promise<WorkshopModDetail>) {
  const client = { getMod: vi.fn(getMod) } as unknown as WorkshopClient;
  return { cache: new WorkshopCache(client, createLogger('silent')), client };
}

describe('WorkshopCache', () => {
  it('serves repeated reads of the same mod from cache', async () => {
    const { cache, client } = cacheWith(async (id) => detail(id));
    await cache.getMod('AAAA000000000001');
    await cache.getMod('AAAA000000000001');
    expect(client.getMod).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent reads into a single upstream request', async () => {
    // This is what stops the mods overview, the dependency check and the
    // mission list from each fanning out over the same ids.
    let resolveFetch: (value: WorkshopModDetail) => void = () => {};
    const { cache, client } = cacheWith(
      () =>
        new Promise<WorkshopModDetail>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const pending = Promise.all([
      cache.getMod('AAAA000000000002'),
      cache.getMod('AAAA000000000002'),
      cache.getMod('AAAA000000000002'),
    ]);
    resolveFetch(detail('AAAA000000000002'));
    const results = await pending;

    expect(client.getMod).toHaveBeenCalledTimes(1);
    expect(results.map((mod) => mod.id)).toEqual([
      'AAAA000000000002',
      'AAAA000000000002',
      'AAAA000000000002',
    ]);
  });

  it('normalises ids so casing differences share one entry', async () => {
    const { cache, client } = cacheWith(async (id) => detail(id));
    await cache.getMod('aaaa000000000003');
    await cache.getMod('AAAA000000000003');
    expect(client.getMod).toHaveBeenCalledTimes(1);
  });

  it('remembers a missing mod instead of asking again', async () => {
    const { cache, client } = cacheWith(async () => {
      throw ApiError.notFound('Workshop mod not found.');
    });
    await expect(cache.getMod('AAAA000000000004')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(cache.getMod('AAAA000000000004')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(client.getMod).toHaveBeenCalledTimes(1);
    expect(cache.peekMod('AAAA000000000004')).toBeNull();
  });

  it('backs off after an upstream failure rather than hammering it', async () => {
    const { cache, client } = cacheWith(async () => {
      throw ApiError.upstream('boom');
    });
    await expect(cache.tryGetMod('AAAA000000000005')).resolves.toBeNull();
    await expect(cache.tryGetMod('AAAA000000000005')).resolves.toBeNull();
    expect(client.getMod).toHaveBeenCalledTimes(1);
  });

  it('reports uncached ids as unknown, not missing', async () => {
    const { cache } = cacheWith(async (id) => detail(id));
    expect(cache.peekMod('AAAA000000000006')).toBeUndefined();
    await cache.getMod('AAAA000000000006');
    expect(cache.peekMod('AAAA000000000006')?.name).toBe('Mod AAAA000000000006');
  });

  it('reuses the detail payload for dependencies instead of a second request', async () => {
    const { cache, client } = cacheWith(async (id) =>
      detail(id, {
        dependencyCount: 1,
        dependencies: [
          {
            id: 'BBBB000000000001',
            name: 'Dep',
            version: null,
            sizeBytes: 10,
            published: true,
            private: false,
          },
        ],
      }),
    );
    const dependencies = await cache.getDependencies('AAAA000000000007');
    expect(dependencies).toHaveLength(1);
    expect(client.getMod).toHaveBeenCalledTimes(1);
  });

  it('skips the scenario request for mods that ship none', async () => {
    const { cache } = cacheWith(async (id) => detail(id, { scenarioCount: 0 }));
    await expect(cache.getScenarios('AAAA000000000008')).resolves.toEqual([]);
  });

  it('drops cached entries on invalidate', async () => {
    const { cache, client } = cacheWith(async (id) => detail(id));
    await cache.getMod('AAAA000000000009');
    cache.invalidate(['AAAA000000000009']);
    await cache.getMod('AAAA000000000009');
    expect(client.getMod).toHaveBeenCalledTimes(2);
  });
});
