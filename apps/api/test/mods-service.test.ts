import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkshopModDetail } from '@reforger-panel/shared';
import { MockGameServerProvider } from '../src/modules/pterodactyl/mock-provider.js';
import { ConfigFileGateway } from '../src/modules/config/config-file-gateway.js';
import { ServerModsService } from '../src/modules/config/mods-service.js';
import type { WorkshopCache } from '../src/modules/workshop/workshop-cache.js';
import type { ServerRecord } from '../src/modules/servers/server-service.js';
import { createLogger } from '../src/lib/logger.js';
import { ApiError } from '../src/lib/errors.js';

const server: ServerRecord = {
  id: 'srv-1',
  slug: 'training-server',
  name: 'SCAR Operations',
  providerType: 'pterodactyl',
  pterodactylServerId: 'abc123',
  status: 'online',
  maxPlayers: 16,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MOCK_MOD = '591AF5BDA9F7CE8B';
const ADMIN_TOOLS = '5AAF0CCE3F001FB5';
const DEPENDENCY = 'BBBB000000000001';

function workshopDetail(overrides: Partial<WorkshopModDetail> & { id: string }) {
  return {
    name: `Mod ${overrides.id}`,
    author: 'Author',
    summary: null,
    imageUrl: null,
    workshopUrl: null,
    version: '1.0.2',
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
  } as WorkshopModDetail;
}

function fakeWorkshop(catalog: Record<string, WorkshopModDetail> = {}) {
  const resolved = new Map(Object.entries(catalog));
  return {
    warm: vi.fn(),
    peekMod: (id: string) => resolved.get(id.toUpperCase()) ?? null,
    tryGetMod: async (id: string) => resolved.get(id.toUpperCase()) ?? null,
    getMod: async (id: string) => {
      const mod = resolved.get(id.toUpperCase());
      if (!mod) throw ApiError.notFound('Workshop mod not found.');
      return mod;
    },
  } as unknown as WorkshopCache;
}

describe('ServerModsService', () => {
  let provider: MockGameServerProvider;
  let gateway: ConfigFileGateway;

  function build(catalog: Record<string, WorkshopModDetail> = {}) {
    return new ServerModsService(gateway, fakeWorkshop(catalog), createLogger('silent'));
  }

  beforeEach(() => {
    provider = new MockGameServerProvider();
    gateway = new ConfigFileGateway(provider, '/config.json');
  });

  it('reads the current mods from config.json with a revision to write back against', async () => {
    const result = await build().getMods(server);
    expect(result.mods).toEqual([{ modId: MOCK_MOD, name: 'Mock Sample Mod', version: '1.0.2' }]);
    expect(result.revision).toMatch(/^[a-f0-9]{16}$/);
  });

  it('writes the new mod list while preserving every other config field', async () => {
    const result = await build().setMods(server, [
      { modId: MOCK_MOD, name: 'Mock Sample Mod', version: '1.0.2' },
      { modId: ADMIN_TOOLS, name: 'Server Admin Tools' },
    ]);

    expect(result.added).toBe(1);
    expect(result.removed).toBe(0);
    expect(result.requiresRestart).toBe(true);
    expect(result.mods).toHaveLength(2);

    const parsed = JSON.parse(provider.writtenFiles.get('/config.json')!);
    expect(parsed.game.mods).toEqual([
      { modId: MOCK_MOD, name: 'Mock Sample Mod', version: '1.0.2' },
      { modId: ADMIN_TOOLS, name: 'Server Admin Tools' },
    ]);
    expect(parsed.bindPort).toBe(2001);
    expect(parsed.game.name).toBe('Mock Reforger Server');
    expect(parsed.game.maxPlayers).toBe(16);
    expect(parsed.operating.disableAI).toBe(false);
    expect(parsed.operating.aiLimit).toBe(40);
  });

  it('counts a version change as changed rather than add plus remove', async () => {
    const result = await build().setMods(server, [
      { modId: MOCK_MOD, name: 'Mock Sample Mod', version: '2.0.0' },
    ]);
    expect(result).toMatchObject({ added: 0, removed: 0, changed: 1 });
  });

  it('writes a rollback backup of the previous file before modifying it', async () => {
    const before = (await provider.downloadTextFile('abc123', '/config.json')).content;
    await build().setMods(server, []);
    expect(provider.writtenFiles.get('/config.json.bak')).toBe(before);
    expect(JSON.parse(provider.writtenFiles.get('/config.json')!).game.mods).toEqual([]);
  });

  it('normalizes mod ids to uppercase and drops empty name/version', async () => {
    const result = await build().setMods(server, [{ modId: '69c566706abd5a3c', name: '' }]);
    expect(result.mods).toEqual([{ modId: '69C566706ABD5A3C' }]);
  });

  it('rejects a write based on a stale revision instead of clobbering it', async () => {
    const service = build();
    const stale = (await service.getMods(server)).revision;
    // Somebody else edits the file in between.
    await service.setMods(server, [{ modId: ADMIN_TOOLS }]);
    await expect(service.setMods(server, [], stale)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('fails the write when read-back verification does not match', async () => {
    const originalWrite = provider.writeTextFile.bind(provider);
    vi.spyOn(provider, 'writeTextFile').mockImplementation(async (sid, path, content) => {
      if (path === '/config.json') return; // swallow the write
      await originalWrite(sid, path, content);
    });
    await expect(build().setMods(server, [])).rejects.toThrow(/verification failed/);
  });

  it('refuses to modify a config without a game section', async () => {
    await provider.writeTextFile('abc123', '/config.json', '{"something": true}');
    await expect(build().setMods(server, [])).rejects.toThrow(ApiError);
  });

  describe('overview', () => {
    it('joins installed mods with workshop metadata and flags updates', async () => {
      const service = build({
        [MOCK_MOD]: workshopDetail({ id: MOCK_MOD, name: 'Mock Sample Mod', version: '1.4.0' }),
      });
      const overview = await service.getOverview(server);

      expect(overview.mods).toHaveLength(1);
      const entry = overview.mods[0]!;
      expect(entry.pinnedVersion).toBe('1.0.2');
      expect(entry.workshop?.latestVersion).toBe('1.4.0');
      expect(entry.updateAvailable).toBe(true);
      expect(overview.updatesAvailable).toBe(1);
      expect(overview.warming).toBe(false);
    });

    it('lists missing dependencies and removal blockers', async () => {
      await build().setMods(server, [{ modId: MOCK_MOD }, { modId: ADMIN_TOOLS }]);
      const service = build({
        [MOCK_MOD]: workshopDetail({
          id: MOCK_MOD,
          dependencyCount: 1,
          dependencies: [
            {
              id: DEPENDENCY,
              name: 'Required Pack',
              version: null,
              sizeBytes: 10,
              published: true,
              private: false,
            },
          ],
        }),
        [ADMIN_TOOLS]: workshopDetail({
          id: ADMIN_TOOLS,
          dependencyCount: 1,
          dependencies: [
            {
              id: MOCK_MOD,
              name: 'Mock Sample Mod',
              version: null,
              sizeBytes: 10,
              published: true,
              private: false,
            },
          ],
        }),
      });

      const overview = await service.getOverview(server);
      const sample = overview.mods.find((mod) => mod.modId === MOCK_MOD)!;
      expect(sample.missingDependencies.map((dep) => dep.id)).toEqual([DEPENDENCY]);
      // Admin Tools depends on the sample mod, so removing it is unsafe.
      expect(sample.requiredBy).toEqual([ADMIN_TOOLS]);
    });

    it('reports mods the workshop could not resolve', async () => {
      const overview = await build().getOverview(server);
      expect(overview.unresolvedIds).toEqual([MOCK_MOD]);
      expect(overview.mods[0]!.workshop).toBeNull();
    });
  });

  describe('resolve', () => {
    it('pulls in transitive dependencies with their sizes', async () => {
      const service = build({
        [MOCK_MOD]: workshopDetail({
          id: MOCK_MOD,
          sizeBytes: 100,
          dependencyCount: 1,
          dependencies: [
            {
              id: DEPENDENCY,
              name: 'Required Pack',
              version: null,
              sizeBytes: 900,
              published: true,
              private: false,
            },
          ],
        }),
        [DEPENDENCY]: workshopDetail({ id: DEPENDENCY, name: 'Required Pack', sizeBytes: 900 }),
      });

      const result = await service.resolve([{ modId: MOCK_MOD, version: '1.0.2' }]);
      expect(result.mods.map((mod) => mod.modId).sort()).toEqual([DEPENDENCY, MOCK_MOD].sort());
      expect(result.addedDependencies).toHaveLength(1);
      expect(result.addedDependencies[0]).toMatchObject({
        modId: DEPENDENCY,
        viaDependency: true,
        requiredBy: [MOCK_MOD],
      });
      expect(result.totalSizeBytes).toBe(1000);
    });

    it('does not loop forever on a circular dependency graph', async () => {
      const service = build({
        [MOCK_MOD]: workshopDetail({
          id: MOCK_MOD,
          dependencies: [
            {
              id: DEPENDENCY,
              name: 'B',
              version: null,
              sizeBytes: 1,
              published: true,
              private: false,
            },
          ],
        }),
        [DEPENDENCY]: workshopDetail({
          id: DEPENDENCY,
          dependencies: [
            {
              id: MOCK_MOD,
              name: 'A',
              version: null,
              sizeBytes: 1,
              published: true,
              private: false,
            },
          ],
        }),
      });
      const result = await service.resolve([{ modId: MOCK_MOD }]);
      expect(result.mods).toHaveLength(2);
    });

    it('names ids the workshop does not know instead of dropping them', async () => {
      const result = await build().resolve([{ modId: 'CCCC000000000009' }]);
      expect(result.unresolvedIds).toEqual(['CCCC000000000009']);
    });
  });
});
