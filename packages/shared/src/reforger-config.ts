/**
 * Typed internal model of the parts of Reforger's server config.json the panel
 * cares about. This is NOT the raw config file — generation/deployment of the
 * real config.json is a later phase.
 */
export type ReforgerConfigMod = {
  modId: string;
  name?: string;
  version?: string;
};

export type ReforgerServerConfig = {
  serverName: string;
  maxPlayers: number;
  scenarioId: string;
  aiLimit: number;
  serverMaxViewDistance: number;
  networkViewDistance: number;
  crossPlatform: boolean;
  disableThirdPerson: boolean;
  mods: ReforgerConfigMod[];
};
