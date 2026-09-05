import type { StartupMirror, StartupVariable } from '@reforger-panel/shared';
import { readAtPath } from './config-tree.js';

/**
 * Reforger eggs commonly regenerate config.json from Pterodactyl startup
 * variables when the container boots. When that happens, editing the file
 * alone looks like it worked — the panel writes it, verifies it, and then the
 * next restart silently throws the change away.
 *
 * This map is how the panel notices. Only pairs whose startup variable
 * actually exists on the egg are reported, so eggs that do not template
 * anything produce no warnings at all.
 */
export const STARTUP_MIRROR_MAP: readonly { envVariable: string; configPath: string }[] = [
  { envVariable: 'SCENARIO_ID', configPath: 'game.scenarioId' },
  { envVariable: 'MISSION_ID', configPath: 'game.scenarioId' },
  { envVariable: 'MAX_PLAYERS', configPath: 'game.maxPlayers' },
  { envVariable: 'SERVER_NAME', configPath: 'game.name' },
  { envVariable: 'HOSTNAME', configPath: 'game.name' },
  { envVariable: 'SERVER_PASSWORD', configPath: 'game.password' },
  { envVariable: 'ADMIN_PASSWORD', configPath: 'game.passwordAdmin' },
  { envVariable: 'GAME_PORT', configPath: 'bindPort' },
  { envVariable: 'SERVER_PORT', configPath: 'bindPort' },
  { envVariable: 'BIND_PORT', configPath: 'bindPort' },
  { envVariable: 'SERVER_IP', configPath: 'bindAddress' },
  { envVariable: 'BIND_ADDRESS', configPath: 'bindAddress' },
  { envVariable: 'A2S_PORT', configPath: 'a2s.port' },
  { envVariable: 'RCON_PORT', configPath: 'rcon.port' },
  { envVariable: 'RCON_PASSWORD', configPath: 'rcon.password' },
  { envVariable: 'CROSS_PLATFORM', configPath: 'game.crossPlatform' },
  { envVariable: 'CROSSPLAY', configPath: 'game.crossPlatform' },
  { envVariable: 'BATTLEYE', configPath: 'game.gameProperties.battlEye' },
  { envVariable: 'VISIBLE', configPath: 'game.visible' },
  { envVariable: 'DISABLE_THIRD_PERSON', configPath: 'game.gameProperties.disableThirdPerson' },
  { envVariable: 'VIEW_DISTANCE', configPath: 'game.gameProperties.serverMaxViewDistance' },
];

/** Loose comparison — startup variables are always strings. */
function sameValue(startupValue: string, configValue: string | number | boolean | null): boolean {
  if (configValue === null) return startupValue === '';
  if (typeof configValue === 'boolean') {
    const normalized = startupValue.trim().toLowerCase();
    return configValue
      ? ['1', 'true', 'yes'].includes(normalized)
      : ['0', 'false', 'no', ''].includes(normalized);
  }
  return String(configValue).trim() === startupValue.trim();
}

export function detectStartupMirrors(
  root: Record<string, unknown>,
  variables: readonly StartupVariable[],
): StartupMirror[] {
  const byEnv = new Map(variables.map((variable) => [variable.envVariable, variable]));
  const mirrors: StartupMirror[] = [];
  const seen = new Set<string>();

  for (const { envVariable, configPath } of STARTUP_MIRROR_MAP) {
    const variable = byEnv.get(envVariable);
    if (!variable) continue;
    const key = `${envVariable}:${configPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const configValue = readAtPath(root, configPath);
    mirrors.push({
      envVariable,
      configPath,
      startupValue: variable.value,
      configValue,
      conflict: !sameValue(variable.value, configValue),
    });
  }

  return mirrors;
}

/** Startup variables that mirror a given config path, for "write both". */
export function mirrorsForPath(path: string, mirrors: readonly StartupMirror[]): StartupMirror[] {
  return mirrors.filter((mirror) => mirror.configPath === path);
}
