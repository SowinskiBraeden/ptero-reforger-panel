import { describe, expect, it, vi } from 'vitest';
import { MockGameServerProvider } from '../src/modules/pterodactyl/mock-provider.js';
import { PterodactylProvider } from '../src/modules/pterodactyl/pterodactyl-provider.js';
import { ApiError } from '../src/lib/errors.js';

const API_KEY = 'ptlc_super_secret_key_123';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MockGameServerProvider', () => {
  it('reports online with plausible resources by default', async () => {
    const provider = new MockGameServerProvider();
    expect(await provider.getServerStatus()).toBe('online');
    const resources = await provider.getServerResources();
    expect(resources.status).toBe('online');
    expect(resources.memoryLimitBytes).toBeGreaterThan(0);
    expect(resources.uptimeMs).toBeGreaterThan(0);
    provider.dispose();
  });

  it('transitions through stopping on stop', async () => {
    const provider = new MockGameServerProvider();
    await provider.stopServer();
    expect(await provider.getServerStatus()).toBe('stopping');
    provider.dispose();
  });

  it('serves a parseable console.log fixture', async () => {
    const provider = new MockGameServerProvider();
    const file = await provider.downloadTextFile('any', '/profile/logs/console.log');
    expect(file.content).toContain('connected');
    expect(file.content).toContain('Log started');
    expect(file.contentStartOffset).toBe(0);
    provider.dispose();
  });

  it('rejects unknown paths instead of exposing a file system', async () => {
    const provider = new MockGameServerProvider();
    await expect(provider.downloadTextFile('any', '/etc/passwd')).rejects.toThrow(ApiError);
    provider.dispose();
  });
});

describe('PterodactylProvider', () => {
  it('maps resource responses from the Client API', async () => {
    const fetchImpl = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith('/resources')) {
        return jsonResponse({
          object: 'stats',
          attributes: {
            current_state: 'running',
            resources: {
              memory_bytes: 1024,
              cpu_absolute: 51.5,
              disk_bytes: 2048,
              network_rx_bytes: 10,
              network_tx_bytes: 20,
              uptime: 5000,
            },
          },
        });
      }
      return jsonResponse({ attributes: { limits: { cpu: 400, memory: 8192, disk: 40960 } } });
    });
    const provider = new PterodactylProvider({
      baseUrl: 'https://panel.example.com',
      apiKey: API_KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const resources = await provider.getServerResources('abc123');
    expect(resources.status).toBe('online');
    expect(resources.cpuPercent).toBe(51.5);
    expect(resources.cpuLimitPercent).toBe(400);
    expect(resources.memoryLimitBytes).toBe(8192 * 1024 * 1024);

    const [calledUrl, calledInit] = fetchImpl.mock.calls[0]!;
    expect(String(calledUrl)).toBe('https://panel.example.com/api/client/servers/abc123/resources');
    const headers = calledInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('sends power signals with the expected body', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
      return new Response(null, { status: 204 });
    });
    const provider = new PterodactylProvider({
      baseUrl: 'https://panel.example.com',
      apiKey: API_KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await provider.restartServer('abc123');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('/power');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ signal: 'restart' });
  });

  it('maps HTTP errors without leaking the API key or full URL', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    const provider = new PterodactylProvider({
      baseUrl: 'https://panel.example.com',
      apiKey: API_KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const error = await provider.getServerResources('abc123').catch((e: unknown) => e as ApiError);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('UPSTREAM_UNAVAILABLE');
    expect((error as ApiError).message).not.toContain(API_KEY);
    expect((error as ApiError).message).not.toContain('panel.example.com');
    expect((error as ApiError).message).toContain('500');
  });

  it('maps timeouts to a sanitized upstream error', async () => {
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    const fetchImpl = vi.fn(async () => {
      throw timeoutError;
    });
    const provider = new PterodactylProvider({
      baseUrl: 'https://panel.example.com',
      apiKey: API_KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 50,
    });
    const error = await provider.getServerStatus('abc123').catch((e: unknown) => e as ApiError);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toContain('timed out');
    expect((error as ApiError).message).not.toContain(API_KEY);
  });
});
