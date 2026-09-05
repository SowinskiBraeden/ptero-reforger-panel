import { describe, expect, it } from 'vitest';
import { applyConfigOps, flattenConfig, readAtPath, verifyConfigOps } from './config-tree.js';

function sampleConfig(): Record<string, unknown> {
  return {
    bindAddress: '0.0.0.0',
    bindPort: 2001,
    game: {
      name: 'Test Server',
      maxPlayers: 16,
      gameProperties: { serverMaxViewDistance: 2500, battlEye: true },
      mods: [{ modId: 'AAAA000000000001' }],
    },
    operating: { aiLimit: 40 },
  };
}

describe('flattenConfig', () => {
  it('exposes every leaf by dotted path', () => {
    const paths = flattenConfig(sampleConfig()).map((entry) => entry.path);
    expect(paths).toContain('bindPort');
    expect(paths).toContain('game.gameProperties.serverMaxViewDistance');
    expect(paths).toContain('operating.aiLimit');
  });

  it('hides the mod list, which the Mods page owns', () => {
    const paths = flattenConfig(sampleConfig()).map((entry) => entry.path);
    expect(paths).not.toContain('game.mods');
  });

  it('records value types so the editor can pick an input', () => {
    const entries = flattenConfig(sampleConfig());
    expect(entries.find((entry) => entry.path === 'bindPort')?.type).toBe('number');
    expect(entries.find((entry) => entry.path === 'bindAddress')?.type).toBe('string');
    expect(entries.find((entry) => entry.path === 'game.gameProperties.battlEye')?.type).toBe(
      'boolean',
    );
  });
});

describe('applyConfigOps', () => {
  it('touches only the given paths and reports what changed', () => {
    const root = sampleConfig();
    const changed = applyConfigOps(root, [
      { path: 'game.maxPlayers', value: 64 },
      { path: 'bindPort', value: 2001 }, // unchanged
    ]);
    expect(changed).toEqual(['game.maxPlayers']);
    expect(readAtPath(root, 'game.maxPlayers')).toBe(64);
    expect(readAtPath(root, 'game.name')).toBe('Test Server');
  });

  it('creates missing intermediate sections when setting a new key', () => {
    const root = sampleConfig();
    applyConfigOps(root, [{ path: 'operating.playerSaveTime', value: 180 }]);
    applyConfigOps(root, [{ path: 'rcon.port', value: 19999 }]);
    expect(readAtPath(root, 'operating.playerSaveTime')).toBe(180);
    expect(readAtPath(root, 'rcon.port')).toBe(19999);
  });

  it('removes a key on null so the game default applies', () => {
    const root = sampleConfig();
    const changed = applyConfigOps(root, [{ path: 'operating.aiLimit', value: null }]);
    expect(changed).toEqual(['operating.aiLimit']);
    expect('aiLimit' in (root.operating as Record<string, unknown>)).toBe(false);
  });

  it('does not create sections just to delete from them', () => {
    const root = sampleConfig();
    const changed = applyConfigOps(root, [{ path: 'nothing.here', value: null }]);
    expect(changed).toEqual([]);
    expect('nothing' in root).toBe(false);
  });

  it('leaves the mod list untouched', () => {
    const root = sampleConfig();
    applyConfigOps(root, [{ path: 'game.maxPlayers', value: 32 }]);
    expect((root.game as Record<string, unknown>).mods).toEqual([{ modId: 'AAAA000000000001' }]);
  });
});

describe('verifyConfigOps', () => {
  it('passes when every op landed', () => {
    const root = sampleConfig();
    const ops = [
      { path: 'game.maxPlayers', value: 64 },
      { path: 'operating.aiLimit', value: null },
    ];
    applyConfigOps(root, ops);
    expect(verifyConfigOps(root, ops)).toBeNull();
  });

  it('names the first path that did not land', () => {
    const root = sampleConfig();
    expect(verifyConfigOps(root, [{ path: 'game.maxPlayers', value: 64 }])).toBe('game.maxPlayers');
  });
});
