/**
 * Startup variables that a Reforger egg typically templates into config.json
 * at boot, and the config path each one lands on.
 *
 * Mirrors the authoritative server-side map in
 * `apps/api/src/modules/config/startup-mirrors.ts`. The API detects these
 * properly (it can see which variables the egg actually exposes and whether
 * the two values currently disagree); this copy exists only so the startup
 * variable list can label a row without a second round trip.
 */
export const STARTUP_MIRROR_HINTS: Record<string, string> = {
  SCENARIO_ID: 'game.scenarioId',
  MISSION_ID: 'game.scenarioId',
  MAX_PLAYERS: 'game.maxPlayers',
  SERVER_NAME: 'game.name',
  HOSTNAME: 'game.name',
  SERVER_PASSWORD: 'game.password',
  ADMIN_PASSWORD: 'game.passwordAdmin',
  GAME_PORT: 'bindPort',
  SERVER_PORT: 'bindPort',
  BIND_PORT: 'bindPort',
  SERVER_IP: 'bindAddress',
  BIND_ADDRESS: 'bindAddress',
  A2S_PORT: 'a2s.port',
  RCON_PORT: 'rcon.port',
  RCON_PASSWORD: 'rcon.password',
  CROSS_PLATFORM: 'game.crossPlatform',
  CROSSPLAY: 'game.crossPlatform',
  BATTLEYE: 'game.gameProperties.battlEye',
  VISIBLE: 'game.visible',
  DISABLE_THIRD_PERSON: 'game.gameProperties.disableThirdPerson',
  VIEW_DISTANCE: 'game.gameProperties.serverMaxViewDistance',
};
