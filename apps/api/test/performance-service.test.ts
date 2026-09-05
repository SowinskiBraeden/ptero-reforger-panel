import { beforeEach, describe, expect, it } from 'vitest';
import { MockGameServerProvider } from '../src/modules/pterodactyl/mock-provider.js';
import { ConfigEditorService } from '../src/modules/config/config-editor-service.js';
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
  let gateway: ConfigFileGateway;
  let editor: ConfigEditorService;
  let service: PerformanceSettingsService;

  beforeEach(() => {
    provider = new MockGameServerProvider();
    gateway = new ConfigFileGateway(provider, '/config.json');
    const configSync = { sync: async () => ({}) } as unknown as ConfigSyncService;
    editor = new ConfigEditorService(gateway, provider, configSync, createLogger('silent'));
    service = new PerformanceSettingsService(gateway, editor, createLogger('silent'));
  });

  it('reads current values, reporting absent keys as null', async () => {
    const { settings } = await service.get(server);
    // Present in the mock config.json:
    expect(settings.maxPlayers).toBe(16);
    expect(settings.serverMaxViewDistance).toBe(2500);
    expect(settings.disableAI).toBe(false);
    expect(settings.aiLimit).toBe(40);
    expect(settings.disableThirdPerson).toBe(false);
    // Absent keys:
    expect(settings.playerSaveTime).toBeNull();
    expect(settings.fastValidation).toBeNull();
  });

  it('sets changed values and removes nulled keys, preserving everything else', async () => {
    const result = await service.update(server, {
      maxPlayers: 32,
      playerSaveTime: 180, // new key
      disableAI: null,
      aiLimit: null, // remove key -> game default
    });

    expect(result.changedFields.sort()).toEqual([
      'aiLimit',
      'disableAI',
      'maxPlayers',
      'playerSaveTime',
    ]);
    expect(result.requiresRestart).toBe(true);

    const written = JSON.parse(provider.writtenFiles.get('/config.json')!);
    expect(written.game.maxPlayers).toBe(32);
    expect(written.operating.playerSaveTime).toBe(180);
    expect('aiLimit' in written.operating).toBe(false);
    // Untouched fields preserved:
    expect(written.bindPort).toBe(2001);
    expect(written.game.scenarioId).toContain('Missions');
    expect(written.game.mods).toHaveLength(1);
    expect(provider.writtenFiles.get('/config.json.bak')).toBeTruthy();
  });

  /**
   * The old form posted every field on every save, so a form loaded before
   * somebody else's change silently reverted it. Only the submitted keys may
   * ever be written.
   */
  it('leaves fields the caller did not submit alone', async () => {
    await service.update(server, { maxPlayers: 48 });
    const written = JSON.parse(provider.writtenFiles.get('/config.json')!);
    expect(written.game.maxPlayers).toBe(48);
    expect(written.game.gameProperties.serverMaxViewDistance).toBe(2500);
    expect(written.operating.aiLimit).toBe(40);
  });

  it('does not write the file at all when nothing changed', async () => {
    const { settings } = await service.get(server);
    const result = await service.update(server, {
      maxPlayers: settings.maxPlayers,
      aiLimit: settings.aiLimit,
    });
    expect(result.changedFields).toEqual([]);
    expect(provider.writtenFiles.has('/config.json')).toBe(false);
  });

  it('rejects a save based on a revision that has since moved', async () => {
    const stale = (await service.get(server)).revision;
    await service.update(server, { maxPlayers: 24 });
    await expect(
      service.update(server, { maxPlayers: 48 }, { expectedRevision: stale }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('ConfigEditorService', () => {
  let provider: MockGameServerProvider;
  let editor: ConfigEditorService;

  beforeEach(() => {
    provider = new MockGameServerProvider();
    const gateway = new ConfigFileGateway(provider, '/config.json');
    const configSync = { sync: async () => ({}) } as unknown as ConfigSyncService;
    editor = new ConfigEditorService(gateway, provider, configSync, createLogger('silent'));
  });

  it('exposes every key in the file, not just the ones the panel knows', async () => {
    const tree = await editor.getTree(server);
    const paths = tree.entries.map((entry) => entry.path);
    expect(paths).toContain('bindAddress');
    expect(paths).toContain('game.crossPlatform');
    expect(paths).toContain('game.gameProperties.networkViewDistance');
    expect(tree.revision).toMatch(/^[a-f0-9]{16}$/);
  });

  /**
   * Reforger eggs often re-template config.json from startup variables at
   * boot, which is why edits could appear to save and then vanish.
   */
  it('flags config keys that a startup variable also controls', async () => {
    const tree = await editor.getTree(server);
    const mirror = tree.mirrors.find((entry) => entry.envVariable === 'MAX_PLAYERS');
    expect(mirror).toBeDefined();
    expect(mirror!.configPath).toBe('game.maxPlayers');
  });

  it('patches an arbitrary path and reports what changed', async () => {
    const result = await editor.patch(server, [
      { path: 'operating.slotReservationTimeout', value: 90 },
    ]);
    expect(result.changedPaths).toEqual(['operating.slotReservationTimeout']);
    const written = JSON.parse(provider.writtenFiles.get('/config.json')!);
    expect(written.operating.slotReservationTimeout).toBe(90);
  });

  it('mirrors a changed value into its startup variable when asked', async () => {
    const result = await editor.patch(server, [{ path: 'game.maxPlayers', value: 40 }], {
      writeStartupVars: true,
    });
    expect(result.startupVarsWritten).toContain('MAX_PLAYERS');
    const variables = await provider.listStartupVariables();
    expect(variables.find((v) => v.envVariable === 'MAX_PLAYERS')?.serverValue).toBe('40');
  });

  it('round-trips the raw editor and rejects invalid JSON', async () => {
    const raw = await editor.getRaw(server);
    expect(JSON.parse(raw.content).game.name).toBe('Mock Reforger Server');
    await expect(editor.putRaw(server, '{ nope')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('refuses a raw write that would drop the game section', async () => {
    await expect(editor.putRaw(server, '{"bindPort":2001}')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
