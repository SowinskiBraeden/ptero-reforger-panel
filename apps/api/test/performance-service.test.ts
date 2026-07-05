import { beforeEach, describe, expect, it } from 'vitest';
import { MockGameServerProvider } from '../src/modules/pterodactyl/mock-provider.js';
import { ConfigFileGateway } from '../src/modules/config/config-file-gateway.js';
import { PerformanceSettingsService } from '../src/modules/config/performance-service.js';
import type { ConfigSyncService } from '../src/modules/config/config-sync.js';
import type { ServerRecord } from '../src/modules/servers/server-service.js';
import { createLogger } from '../src/lib/logger.js';

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

describe('PerformanceSettingsService', () => {
  let provider: MockGameServerProvider;
  let service: PerformanceSettingsService;

  beforeEach(() => {
    provider = new MockGameServerProvider();
    const configSync = { sync: async () => ({}) } as unknown as ConfigSyncService;
    service = new PerformanceSettingsService(
      new ConfigFileGateway(provider, '/config.json'),
      configSync,
      createLogger('silent'),
    );
  });

  it('reads current values, reporting absent keys as null', async () => {
    const { settings } = await service.get(server);
    // Present in the mock config.json:
    expect(settings.maxPlayers).toBe(16);
    expect(settings.serverMaxViewDistance).toBe(2500);
    expect(settings.aiLimit).toBe(40);
    expect(settings.disableThirdPerson).toBe(false);
    // Absent keys:
    expect(settings.playerSaveTime).toBeNull();
    expect(settings.fastValidation).toBeNull();
  });

  it('sets changed values and removes nulled keys, preserving everything else', async () => {
    const { settings } = await service.get(server);
    const result = await service.update(server, {
      ...settings,
      maxPlayers: 32,
      playerSaveTime: 180, // new key
      aiLimit: null, // remove key → game default
    });

    expect(result.changedFields.sort()).toEqual(['aiLimit', 'maxPlayers', 'playerSaveTime']);
    expect(result.requiresRestart).toBe(true);

    const written = JSON.parse(provider.writtenFiles.get('/config.json')!);
    expect(written.game.maxPlayers).toBe(32);
    expect(written.operating.playerSaveTime).toBe(180);
    expect('aiLimit' in written.operating).toBe(false);
    // Untouched fields preserved:
    expect(written.bindPort).toBe(2001);
    expect(written.game.scenarioId).toContain('Missions');
    expect(written.game.mods).toHaveLength(1);
    // Backup written:
    expect(provider.writtenFiles.get('/config.json.bak')).toBeTruthy();
  });

  it('does not write the file at all when nothing changed', async () => {
    const { settings } = await service.get(server);
    const result = await service.update(server, settings);
    expect(result.changedFields).toEqual([]);
    expect(provider.writtenFiles.has('/config.json')).toBe(false);
  });
});
