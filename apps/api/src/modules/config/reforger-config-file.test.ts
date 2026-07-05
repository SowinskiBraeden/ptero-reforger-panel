import { describe, expect, it } from 'vitest';
import { parseReforgerConfigJson } from './reforger-config-file.js';
import { ApiError } from '../../lib/errors.js';

// Shape from the Reforger dedicated-server docs / typical Pterodactyl egg output.
const REAL_SHAPE = {
  bindAddress: '0.0.0.0',
  bindPort: 2001,
  publicAddress: '',
  publicPort: 2001,
  a2s: { address: '0.0.0.0', port: 17777 },
  rcon: { address: '127.0.0.1', port: 19999, password: 'hunter2', permission: 'admin' },
  game: {
    name: 'DazzledCorp Training Grounds',
    password: '',
    passwordAdmin: 'secret',
    admins: ['76561198000000000'],
    scenarioId: '{ECC61978EDCC2B5A}Missions/23_Campaign.conf',
    maxPlayers: 16,
    visible: true,
    crossPlatform: true,
    supportedPlatforms: ['PLATFORM_PC', 'PLATFORM_XBL'],
    gameProperties: {
      serverMaxViewDistance: 2500,
      serverMinGrassDistance: 50,
      networkViewDistance: 1000,
      disableThirdPerson: true,
      fastValidation: true,
      battlEye: true,
      VONDisableUI: false,
    },
    mods: [
      { modId: '591AF5BDA9F7CE8B', name: 'Some Mod', version: '1.0.2' },
      { modId: '5AAF0CCE3F001FB5' },
    ],
  },
  operating: { lobbyPlayerSynchronise: true, aiLimit: -1, playerSaveTime: 120 },
};

describe('parseReforgerConfigJson', () => {
  it('maps a real-shaped config.json into the panel model', () => {
    const config = parseReforgerConfigJson(JSON.stringify(REAL_SHAPE));
    expect(config).toEqual({
      serverName: 'DazzledCorp Training Grounds',
      maxPlayers: 16,
      scenarioId: '{ECC61978EDCC2B5A}Missions/23_Campaign.conf',
      aiLimit: -1,
      serverMaxViewDistance: 2500,
      networkViewDistance: 1000,
      crossPlatform: true,
      disableThirdPerson: true,
      mods: [
        { modId: '591AF5BDA9F7CE8B', name: 'Some Mod', version: '1.0.2' },
        { modId: '5AAF0CCE3F001FB5' },
      ],
    });
  });

  it('never includes credentials from the config file in the mapped model', () => {
    const json = JSON.stringify(parseReforgerConfigJson(JSON.stringify(REAL_SHAPE)));
    expect(json).not.toContain('hunter2');
    expect(json).not.toContain('secret');
  });

  it('tolerates missing sections with neutral defaults', () => {
    const config = parseReforgerConfigJson('{"game":{"name":"Bare"}}');
    expect(config.serverName).toBe('Bare');
    expect(config.maxPlayers).toBe(0);
    expect(config.aiLimit).toBe(-1);
    expect(config.mods).toEqual([]);
  });

  it('rejects invalid JSON with a sanitized upstream error', () => {
    expect(() => parseReforgerConfigJson('not json {')).toThrow(ApiError);
  });
});
