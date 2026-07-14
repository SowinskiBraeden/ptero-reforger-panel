import type { ReforgerServerConfig } from '@reforger-panel/shared';
import { ApiError } from '../../lib/errors.js';

/**
 * Maps a real Reforger server `config.json` (the file the dedicated server
 * runs with, documented at
 * https://community.bistudio.com/wiki/Arma_Reforger:Server_Config) into the
 * panel's internal config model. Mapping is defensive: missing or oddly-typed
 * fields fall back to neutral defaults instead of failing the sync.
 */

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function mapReforgerConfig(raw: unknown): ReforgerServerConfig {
  const root = record(raw);
  const game = record(root.game);
  const gameProperties = record(game.gameProperties);
  const operating = record(root.operating);

  const mods = Array.isArray(game.mods)
    ? game.mods
        .map((entry) => {
          const mod = record(entry);
          const modId = str(mod.modId);
          if (!modId) return null;
          return {
            modId,
            name: str(mod.name) || undefined,
            version: str(mod.version) || undefined,
          };
        })
        .filter((mod): mod is NonNullable<typeof mod> => mod !== null)
    : [];

  return {
    serverName: str(game.name, 'Unnamed server'),
    maxPlayers: num(game.maxPlayers, 0),
    scenarioId: str(game.scenarioId),
    disableAI: bool(operating.disableAI, false),
    // -1 means "no limit" in Reforger's operating.aiLimit.
    aiLimit: num(operating.aiLimit, -1),
    serverMaxViewDistance: num(gameProperties.serverMaxViewDistance, 0),
    networkViewDistance: num(gameProperties.networkViewDistance, 0),
    crossPlatform: bool(game.crossPlatform, false),
    disableThirdPerson: bool(gameProperties.disableThirdPerson, false),
    mods,
  };
}

export function parseReforgerConfigJson(content: string): ReforgerServerConfig {
  const text = content.replace(/^\uFEFF/, '').trim();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw ApiError.upstream('Server config.json is not valid JSON.');
  }
  return mapReforgerConfig(raw);
}
