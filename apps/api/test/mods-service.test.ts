import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockGameServerProvider } from '../src/modules/pterodactyl/mock-provider.js';
import { ConfigFileGateway } from '../src/modules/config/config-file-gateway.js';
import { ServerModsService } from '../src/modules/config/mods-service.js';
import type { ConfigSyncService } from '../src/modules/config/config-sync.js';
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

describe('ServerModsService', () => {
  let provider: MockGameServerProvider;
  let service: ServerModsService;
  let configSyncCalled: number;

  beforeEach(() => {
    provider = new MockGameServerProvider();
    configSyncCalled = 0;
    const configSync = {
      sync: async () => {
        configSyncCalled += 1;
        return { changed: true, revisionVersion: 2, serverName: 'x', maxPlayers: 16 };
      },
    } as unknown as ConfigSyncService;
    service = new ServerModsService(
      new ConfigFileGateway(provider, '/config.json'),
      configSync,
      createLogger('silent'),
    );
  });

  it('reads the current mods from config.json', async () => {
    const result = await service.getMods(server);
    expect(result.mods).toEqual([
      { modId: '591AF5BDA9F7CE8B', name: 'Mock Sample Mod', version: '1.0.2' },
    ]);
  });

  it('writes the new mod list while preserving every other config field', async () => {
    const result = await service.setMods(server, [
      { modId: '591AF5BDA9F7CE8B', name: 'Mock Sample Mod', version: '1.0.2' },
      { modId: '5AAF0CCE3F001FB5', name: 'Server Admin Tools' },
    ]);

    expect(result.added).toBe(1);
    expect(result.removed).toBe(0);
    expect(result.requiresRestart).toBe(true);
    expect(result.mods).toHaveLength(2);

    const written = provider.writtenFiles.get('/config.json')!;
    const parsed = JSON.parse(written);
    // game.mods replaced…
    expect(parsed.game.mods).toEqual([
      { modId: '591AF5BDA9F7CE8B', name: 'Mock Sample Mod', version: '1.0.2' },
      { modId: '5AAF0CCE3F001FB5', name: 'Server Admin Tools' },
    ]);
    // …everything else untouched.
    expect(parsed.bindPort).toBe(2001);
    expect(parsed.game.name).toBe('Mock Reforger Server');
    expect(parsed.game.maxPlayers).toBe(16);
    expect(parsed.operating.aiLimit).toBe(40);
  });

  it('writes a rollback backup of the previous file before modifying it', async () => {
    const before = (await provider.downloadTextFile('abc123', '/config.json')).content;
    await service.setMods(server, []);
    expect(provider.writtenFiles.get('/config.json.bak')).toBe(before);
    // Removal reflected in the live file.
    const after = JSON.parse(provider.writtenFiles.get('/config.json')!);
    expect(after.game.mods).toEqual([]);
  });

  it('imports a config revision after a successful write', async () => {
    await service.setMods(server, []);
    expect(configSyncCalled).toBe(1);
  });

  it('normalizes mod ids to uppercase and drops empty name/version', async () => {
    const result = await service.setMods(server, [{ modId: '69c566706abd5a3c', name: '' }]);
    expect(result.mods).toEqual([{ modId: '69C566706ABD5A3C' }]);
  });

  it('fails the write when read-back verification does not match', async () => {
    // Simulate a server that ignores writes to config.json.
    const originalWrite = provider.writeTextFile.bind(provider);
    vi.spyOn(provider, 'writeTextFile').mockImplementation(async (sid, path, content) => {
      if (path === '/config.json') return; // swallow the write
      await originalWrite(sid, path, content);
    });
    await expect(service.setMods(server, [])).rejects.toThrow(/verification failed/);
  });

  it('refuses to modify a config without a game section', async () => {
    await provider.writeTextFile('abc123', '/config.json', '{"something": true}');
    await expect(service.setMods(server, [])).rejects.toThrow(ApiError);
  });
});
