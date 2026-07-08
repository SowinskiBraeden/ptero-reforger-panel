import { describe, expect, it, vi } from 'vitest';
import { WorkshopClient, normalizeImageUrl } from './workshop-client.js';

const REAL_IMAGE = 'https://ar-gcp-cdn.bistudio.com/image/abcd/1234';

function listResponse() {
  return {
    status: 'success',
    meta: { totalPages: 1, currentPage: 1, totalMods: 2, shownMods: 2 },
    data: [
      {
        name: 'Mod A',
        author: 'Author',
        imageURL: 'https://via.placeholder.com/640x360',
        originalModURL: 'https://reforger.armaplatform.com/workshop/AAAAAAAAAAAAAAA1',
        apiModURL: 'https://api.reforgermods.net/v1/mod/AAAAAAAAAAAAAAA1',
        size: '1 MB',
        rating: '99%',
        ID: 'AAAAAAAAAAAAAAA1',
      },
    ],
  };
}

function detailResponse(id: string) {
  return {
    status: 'success',
    mod: {
      name: 'Mod A',
      author: 'Author',
      originalModURL: `https://reforger.armaplatform.com/workshop/${id}`,
      apiModURL: `https://api.reforgermods.net/v1/mod/${id}`,
      // Upstream bug: two URLs concatenated.
      imageURL: `https://reforger.armaplatform.com${REAL_IMAGE}`,
      rating: '99%',
      version: '1.2.0',
      size: '1 MB',
      id,
      tags: [],
      dependencies: [],
      scenarios: [],
    },
  };
}

describe('normalizeImageUrl', () => {
  it('drops dead placeholder URLs', () => {
    expect(normalizeImageUrl('https://via.placeholder.com/640x360')).toBeNull();
  });

  it('repairs concatenated double URLs', () => {
    expect(normalizeImageUrl(`https://reforger.armaplatform.com${REAL_IMAGE}`)).toBe(REAL_IMAGE);
  });

  it('passes through well-formed URLs and rejects junk', () => {
    expect(normalizeImageUrl(REAL_IMAGE)).toBe(REAL_IMAGE);
    expect(normalizeImageUrl('')).toBeNull();
    expect(normalizeImageUrl('not a url')).toBeNull();
  });
});

describe('WorkshopClient preview cache', () => {
  it('does not fan out detail requests during search', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const path = String(url);
      if (path.includes('/v1/mod/')) {
        const id = path.slice(path.lastIndexOf('/') + 1);
        return new Response(JSON.stringify(detailResponse(id)), { status: 200 });
      }
      return new Response(JSON.stringify(listResponse()), { status: 200 });
    });
    const client = new WorkshopClient({
      baseUrl: 'https://workshop.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const first = await client.search('', 1);
    expect(first.mods[0]!.imageUrl).toBeNull();
    expect(first.mods[0]!.version).toBeNull();
    const detailCalls = fetchImpl.mock.calls.filter((c) => String(c[0]).includes('/v1/mod/'));
    expect(detailCalls).toHaveLength(0);

    await client.getMod('AAAAAAAAAAAAAAA1');

    // Second search can use the cached detail without another detail request.
    const second = await client.search('', 1);
    expect(second.mods[0]!.imageUrl).toBe(REAL_IMAGE);
    expect(second.mods[0]!.version).toBe('1.2.0');
    const detailCallsAfter = fetchImpl.mock.calls.filter((c) => String(c[0]).includes('/v1/mod/'));
    expect(detailCallsAfter).toHaveLength(1);
  });

  it('leaves the image empty when there is no cached detail', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      return new Response(JSON.stringify(listResponse()), { status: 200 });
    });
    const client = new WorkshopClient({
      baseUrl: 'https://workshop.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.search('', 1);
    expect(result.mods[0]!.imageUrl).toBeNull();
  });

  it('extracts scenario IDs from malformed scenario metadata', async () => {
    const fetchImpl = vi.fn(async () => {
      const detail = detailResponse('AAAAAAAAAAAAAAA1');
      detail.mod.scenarios = [
        {
          name: '[OG] Udachne',
          description: '',
          scenarioID: '',
          gamemode: 'Scenario ID{39AB5D9094E502AA}Missions/OG_Conflict.conf',
          playerCount: 0,
          imageURL: '',
        },
      ];
      return new Response(JSON.stringify(detail), { status: 200 });
    });
    const client = new WorkshopClient({
      baseUrl: 'https://workshop.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const mod = await client.getMod('AAAAAAAAAAAAAAA1');
    expect(mod.scenarios[0]).toMatchObject({
      scenarioId: '{39AB5D9094E502AA}Missions/OG_Conflict.conf',
      gamemode: null,
    });
  });
});
