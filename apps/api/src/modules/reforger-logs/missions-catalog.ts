import type { MissionInfo, MissionsResponse, WorkshopModDetail } from '@reforger-panel/shared';
import type { GameServerProvider } from '../pterodactyl/types.js';
import type { LogPathResolver } from './ingestion/log-path-resolver.js';

const CATALOG_TTL_MS = 10 * 60 * 1000;
const CATALOG_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Scenario listing printed at boot when the server runs with -listScenarios
 * (verified against real logs):
 *   12:54:28.215 SCRIPT : Official scenarios (31 entries)
 *   12:54:28.216 SCRIPT : {ECC61978EDCC2B5A}Missions/23_Campaign.conf (Conflict - Everon)
 */
const SECTION_PATTERN = /SCRIPT\s*:\s*(.+ scenarios) \(\d+ entr/i;
const MISSION_PATTERN = /SCRIPT\s*:\s*(\{[0-9A-Fa-f]{16}\}\S+\.conf)(?:\s+\((.+)\))?\s*$/;

export function parseMissionList(logContent: string): MissionInfo[] {
  const missions: MissionInfo[] = [];
  const seen = new Set<string>();
  let currentSource = 'official';
  for (const line of logContent.split('\n')) {
    const section = SECTION_PATTERN.exec(line);
    if (section) {
      currentSource = section[1]!.toLowerCase().replace(/ scenarios$/, '');
      continue;
    }
    const mission = MISSION_PATTERN.exec(line);
    if (mission && !seen.has(mission[1]!)) {
      seen.add(mission[1]!);
      missions.push({
        scenarioId: mission[1]!,
        name: mission[2] ?? mission[1]!.slice(mission[1]!.lastIndexOf('/') + 1),
        source: currentSource,
      });
    }
  }
  return missions;
}

export function scenariosFromWorkshopMod(mod: WorkshopModDetail): MissionInfo[] {
  return mod.scenarios.map((scenario) => ({
    scenarioId: scenario.scenarioId,
    name: scenario.name,
    source: `mod: ${mod.name}`,
  }));
}

export function mergeMissions(...groups: MissionInfo[][]): MissionInfo[] {
  const merged: MissionInfo[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const mission of group) {
      if (seen.has(mission.scenarioId)) continue;
      seen.add(mission.scenarioId);
      merged.push(mission);
    }
  }
  return merged;
}

/**
 * Extracts the available-missions dropdown data from the server's current
 * console.log. Cached briefly; a fresh boot log always carries the listing
 * near the top, so the head of the file is enough.
 */
export class MissionCatalog {
  private cache: { missions: MissionInfo[]; fetchedAt: string; expiresAt: number } | null = null;

  constructor(
    private readonly provider: GameServerProvider,
    private readonly resolveLogPath: LogPathResolver,
    private readonly providerServerId: string,
  ) {}

  async list(force = false): Promise<MissionsResponse> {
    if (!force && this.cache && this.cache.expiresAt > Date.now()) {
      return { missions: this.cache.missions, fetchedAt: this.cache.fetchedAt };
    }
    const logPath = await this.resolveLogPath();
    if (!logPath) return { missions: [], fetchedAt: null };
    const file = await this.provider.downloadTextFile(
      this.providerServerId,
      logPath,
      CATALOG_MAX_BYTES,
    );
    const missions = parseMissionList(file.content);
    if (missions.length > 0) {
      this.cache = {
        missions,
        fetchedAt: new Date().toISOString(),
        expiresAt: Date.now() + CATALOG_TTL_MS,
      };
      return { missions, fetchedAt: this.cache.fetchedAt };
    }
    // Long-running servers may have rotated past the listing; keep the last
    // known catalog rather than returning nothing.
    if (this.cache) {
      return { missions: this.cache.missions, fetchedAt: this.cache.fetchedAt };
    }
    return { missions: [], fetchedAt: null };
  }
}
