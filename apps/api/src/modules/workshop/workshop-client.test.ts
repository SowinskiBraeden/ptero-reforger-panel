import { describe, expect, it, vi } from 'vitest';
import { WorkshopClient, localizedLabel, normalizeImageUrl } from './workshop-client.js';

const REAL_IMAGE = 'https://ar-gcp-cdn.bistudio.com/image/abcd/1234';
const MOD_ID = '595F2BF2F44836FB';

/** Shape taken from a real GET /v2/mods response. */
function listResponse() {
  return {
    status: 'success',
    meta: { totalPages: 3, currentPage: 1, totalMods: 42, shownMods: 1 },
    data: [
      {
        id: MOD_ID,
        name: 'Mod A',
        author: 'Author',
        summary: 'Summary',
        version: '1.2.0',
        gameVersion: '1.8.0.10',
        size: 204219382,
        sizeFormatted: '195 MiB',
        rating: 0.88,
        ratingCount: 9323,
        subscriberCount: 31997,
        updatedAt: '2026-08-14T06:07:52Z',
        tags: ['WEAPONS'],
        // Upstream still serves placeholder stubs on some rows.
        imageUrl: 'https://via.placeholder.com/640x360',
        workshopUrl: `https://reforger.armaplatform.com/workshop/${MOD_ID}`,
      },
    ],
  };
}

function detailResponse() {
  return {
    status: 'success',
    mod: {
      id: MOD_ID,
      name: 'Mod A',
      author: 'Author',
      version: '1.2.0',
      // Upstream bug: two URLs concatenated.
      imageUrl: `https://reforger.armaplatform.com${REAL_IMAGE}`,
      size: 0,
      previewImages: [REAL_IMAGE],
      screenshots: [],
      scenarioCount: 2,
      dependencyCount: 1,
      totalSize: 8940841288,
      tags: ['SCENARIOS_MP'],
      dependencies: [
        {
          id: '1337c0de5dabbeef',
          name: 'Content Pack',
          version: '0.16.5150',
          size: 6343204665,
          published: true,
          private: false,
        },
      ],
      scenarios: [
        {
          name: 'Conflict - Everon (RHS)',
          gameId: '{AAD43C10045857C1}Missions/RHS_Conflict.conf',
          gameMode: '#AR-Scenario_GameMode_Campaign',
          author: '#AR-Author_BI',
          description: '#AR-Campaign_GamemodeDesc',
          playerCount: 64,
        },
        // No gameId: unusable as a mission, so it must be dropped.
        { name: 'Broken', gameId: '', gameMode: null, playerCount: 0 },
      ],
    },
  };
}

function client(handler: (path: string) => unknown) {
  const fetchImpl = vi.fn(async (url: string | URL) => {
    const path = String(url).replace('https://workshop.test', '');
    return new Response(JSON.stringify(handler(path)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return {
    client: new WorkshopClient({ baseUrl: 'https://workshop.test', fetchImpl }),
    fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn>,
  };
}

describe('normalizeImageUrl', () => {
  it('drops placeholder stubs', () => {
    expect(normalizeImageUrl('https://via.placeholder.com/640x360')).toBeNull();
  });

  it('recovers the real URL from a concatenated pair', () => {
    expect(normalizeImageUrl(`https://reforger.armaplatform.com${REAL_IMAGE}`)).toBe(REAL_IMAGE);
  });

  it('returns null for empty or non-http values', () => {
    expect(normalizeImageUrl('')).toBeNull();
    expect(normalizeImageUrl('not-a-url')).toBeNull();
  });
});

describe('localizedLabel', () => {
  it('maps known Enfusion localization keys', () => {
    expect(localizedLabel('#AR-Scenario_GameMode_Campaign')).toBe('Campaign');
  });

  it('humanises unknown keys instead of leaking them', () => {
    expect(localizedLabel('#AR-Scenario_GameMode_KingOfTheHill')).toBe('King Of The Hill');
  });

  it('passes plain text through', () => {
    expect(localizedLabel('Sandbox')).toBe('Sandbox');
    expect(localizedLabel(null)).toBeNull();
  });
});

describe('WorkshopClient (v2)', () => {
  it('maps search results with typed sizes and ratings', async () => {
    const { client: workshop, fetchImpl } = client(() => listResponse());
    const result = await workshop.search({
      query: 'mod a',
      page: 2,
      sort: 'newest',
      tag: 'WEAPONS',
    });

    expect(String(fetchImpl.mock.calls[0]![0])).toContain('/v2/mods?');
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('tags=WEAPONS');
    expect(result.meta.totalMods).toBe(42);
    const mod = result.mods[0]!;
    expect(mod.sizeBytes).toBe(204219382);
    expect(mod.rating).toBe(0.88);
    expect(mod.subscriberCount).toBe(31997);
    expect(mod.imageUrl).toBeNull(); // placeholder stripped
  });

  it('maps mod details, uppercasing dependency ids and keeping real scenario ids', async () => {
    const { client: workshop } = client(() => detailResponse());
    const detail = await workshop.getMod(MOD_ID);

    expect(detail.dependencies).toEqual([
      {
        id: '1337C0DE5DABBEEF',
        name: 'Content Pack',
        version: '0.16.5150',
        sizeBytes: 6343204665,
        published: true,
        private: false,
      },
    ]);
    expect(detail.scenarios).toHaveLength(1);
    expect(detail.scenarios[0]).toEqual({
      scenarioId: '{AAD43C10045857C1}Missions/RHS_Conflict.conf',
      name: 'Conflict - Everon (RHS)',
      gameMode: 'Campaign',
      author: 'BI',
      description: 'Campaign',
      playerCount: 64,
    });
    expect(detail.imageUrl).toBe(REAL_IMAGE);
    // Upstream reports 0 for "unknown", which must not read as "0 bytes".
    expect(detail.sizeBytes).toBeNull();
    expect(detail.totalSizeBytes).toBe(8940841288);
  });

  it('maps the version history used by the version picker', async () => {
    const { client: workshop } = client(() => ({
      status: 'success',
      data: {
        modId: MOD_ID,
        count: 1,
        versions: [
          {
            version: '0.16.5150',
            gameVersion: '1.8.0.10',
            size: 204219382,
            sizeFormatted: '195 MiB',
            approved: true,
            published: true,
            createdAt: '2026-08-14T06:05:43Z',
            scenarioCount: 11,
            dependencyCount: 2,
          },
        ],
      },
    }));

    const result = await workshop.getVersions(MOD_ID);
    expect(result.modId).toBe(MOD_ID);
    expect(result.versions[0]).toMatchObject({
      version: '0.16.5150',
      gameVersion: '1.8.0.10',
      sizeBytes: 204219382,
      approved: true,
    });
  });

  it('maps a server mod list for the import-from-server flow', async () => {
    const { client: workshop } = client(() => ({
      status: 'success',
      serverId: 'room-1',
      summary: { count: 2, knownSize: 4096, unresolvedCount: 1 },
      data: [
        { id: '69f40d8f38530936', name: 'Hogs Scenario Core', version: '1.0.20', size: 2011590 },
        { id: '64610AFB74AA9842', name: 'WCS_Core', version: null, size: 0 },
      ],
    }));

    const result = await workshop.getServerMods('room-1');
    expect(result.mods).toEqual([
      {
        id: '69F40D8F38530936',
        name: 'Hogs Scenario Core',
        version: '1.0.20',
        sizeBytes: 2011590,
      },
      { id: '64610AFB74AA9842', name: 'WCS_Core', version: null, sizeBytes: null },
    ]);
    expect(result.unresolvedCount).toBe(1);
  });

  it('translates upstream failures into ApiError codes', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('nope', { status: 429 }),
    ) as unknown as typeof fetch;
    const workshop = new WorkshopClient({ baseUrl: 'https://workshop.test', fetchImpl });
    await expect(workshop.getMod(MOD_ID)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
