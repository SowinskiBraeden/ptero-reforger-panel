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

describe('WorkshopClient image enrichment', () => {
  it('warms list images from the detail endpoint in the background and caches them', async () => {
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
    await vi.waitFor(() => {
      const detailCalls = fetchImpl.mock.calls.filter((c) => String(c[0]).includes('/v1/mod/'));
      expect(detailCalls).toHaveLength(1);
    });
    const detailCalls = fetchImpl.mock.calls.filter((c) => String(c[0]).includes('/v1/mod/'));
    expect(detailCalls).toHaveLength(1);

    // Second search hits the cache — no extra detail request.
    const second = await client.search('', 1);
    expect(second.mods[0]!.imageUrl).toBe(REAL_IMAGE);
    const detailCallsAfter = fetchImpl.mock.calls.filter((c) => String(c[0]).includes('/v1/mod/'));
    expect(detailCallsAfter).toHaveLength(1);
  });

  it('leaves the image empty when the detail fetch fails', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const path = String(url);
      if (path.includes('/v1/mod/')) {
        return new Response('nope', { status: 500 });
      }
      return new Response(JSON.stringify(listResponse()), { status: 200 });
    });
    const client = new WorkshopClient({
      baseUrl: 'https://workshop.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.search('', 1);
    expect(result.mods[0]!.imageUrl).toBeNull();
  });
});
