import type {
  MissionGroup,
  MissionInfo,
  MissionsResponse,
  ReforgerConfigMod,
} from '@reforger-panel/shared';
import type { WorkshopCache } from '../workshop/workshop-cache.js';
import type { GameServerProvider } from '../pterodactyl/types.js';
import type { LogPathResolver } from './ingestion/log-path-resolver.js';

const CATALOG_TTL_MS = 10 * 60 * 1000;
const CATALOG_MAX_BYTES = 2 * 1024 * 1024;

/** Kept as the "known-good fallback" target for orphaned-mission recovery. */
export const DEFAULT_SCENARIO_ID = '{FDE33AFE2ED7875B}Missions/23_Campaign_Montignac.conf';

/**
 * Scenarios that ship with the base game.
 *
 * Compiled from the scenario ids live vanilla servers actually report (i.e.
 * servers whose scenario is not provided by a Workshop mod), so the list
 * reflects the shipped game rather than guesswork. It is a seed, not a closed
 * set: anything the server itself prints at boot with `-listScenarios` is
 * merged on top, so a game update that adds a mission still shows up.
 */
export const OFFICIAL_MISSIONS: readonly MissionInfo[] = [
  {
    scenarioId: '{ECC61978EDCC2B5A}Missions/23_Campaign.conf',
    name: 'Conflict - Everon',
    gameMode: 'Conflict',
    playerCount: 128,
  },
  {
    scenarioId: '{C41618FD18E9D714}Missions/23_Campaign_Arland.conf',
    name: 'Conflict - Arland',
    gameMode: 'Conflict',
    playerCount: 128,
  },
  {
    scenarioId: '{9C6054B42A044DEC}Missions/23_Campaign_Cain.conf',
    name: 'Conflict - Kolguyev',
    gameMode: 'Conflict',
    playerCount: 128,
  },
  {
    scenarioId: '{28802845ADA64D52}Missions/23_Campaign_NorthCentral.conf',
    name: 'Conflict - Northern Everon',
    gameMode: 'Conflict',
    playerCount: 64,
  },
  {
    scenarioId: DEFAULT_SCENARIO_ID,
    name: 'Conflict - Montignac',
    gameMode: 'Conflict',
    playerCount: 64,
  },
  {
    scenarioId: '{0220741028718E7F}Missions/23_Campaign_HQC_Everon.conf',
    name: 'Commander - Everon',
    gameMode: 'Commander',
    playerCount: 128,
  },
  {
    scenarioId: '{68D1240A11492545}Missions/23_Campaign_HQC_Arland.conf',
    name: 'Commander - Arland',
    gameMode: 'Commander',
    playerCount: 128,
  },
  {
    scenarioId: '{BB5345C22DD2B655}Missions/23_Campaign_HQC_Cain.conf',
    name: 'Commander - Kolguyev',
    gameMode: 'Commander',
    playerCount: 128,
  },
  {
    scenarioId: '{DAA03C6E6099D50F}Missions/24_CombatOps.conf',
    name: 'Combat Ops - Arland',
    gameMode: 'Combat Ops',
    playerCount: 16,
  },
  {
    scenarioId: '{DFAC5FABD11F2390}Missions/26_CombatOpsEveron.conf',
    name: 'Combat Ops - Everon',
    gameMode: 'Combat Ops',
    playerCount: 16,
  },
  {
    scenarioId: '{CB347F2F10065C9C}Missions/CombatOpsCain.conf',
    name: 'Combat Ops - Kolguyev',
    gameMode: 'Combat Ops',
    playerCount: 16,
  },
  {
    scenarioId: '{59AD59368755F41A}Missions/21_GM_Eden.conf',
    name: 'Game Master - Everon',
    gameMode: 'Game Master',
    playerCount: 64,
  },
  {
    scenarioId: '{2BBBE828037C6F4B}Missions/22_GM_Arland.conf',
    name: 'Game Master - Arland',
    gameMode: 'Game Master',
    playerCount: 64,
  },
  {
    scenarioId: '{F45C6C15D31252E6}Missions/27_GM_Cain.conf',
    name: 'Game Master - Kolguyev',
    gameMode: 'Game Master',
    playerCount: 64,
  },
  {
    scenarioId: '{3F2E005F43DBD2F8}Missions/CAH_Briars_Coast.conf',
    name: 'Capture & Hold - The Briars',
    gameMode: 'Capture & Hold',
    playerCount: 32,
  },
  {
    scenarioId: '{589945FB9FA7B97D}Missions/CAH_Concrete_Plant.conf',
    name: 'Capture & Hold - Concrete Plant',
    gameMode: 'Capture & Hold',
    playerCount: 32,
  },
  {
    scenarioId: '{9405201CBD22A30C}Missions/CAH_Factory.conf',
    name: 'Capture & Hold - Almara Factory',
    gameMode: 'Capture & Hold',
    playerCount: 32,
  },
  {
    scenarioId: '{1CD06B409C6FAE56}Missions/CAH_Forest.conf',
    name: "Capture & Hold - Simon's Wood",
    gameMode: 'Capture & Hold',
    playerCount: 32,
  },
  {
    scenarioId: '{7C491B1FCC0FF0E1}Missions/CAH_LeMoule.conf',
    name: 'Capture & Hold - Le Moule',
    gameMode: 'Capture & Hold',
    playerCount: 32,
  },
  {
    scenarioId: '{2B4183DF23E88249}Missions/CAH_Morton.conf',
    name: 'Capture & Hold - Morton',
    gameMode: 'Capture & Hold',
    playerCount: 32,
  },
];

export const OFFICIAL_SCENARIO_IDS = new Set(
  OFFICIAL_MISSIONS.map((mission) => mission.scenarioId),
);

export type ParsedMission = MissionInfo & { source: string };

/**
 * Scenario listing printed at boot when the server runs with -listScenarios
 * (verified against real logs):
 *   12:54:28.215 SCRIPT : Official scenarios (31 entries)
 *   12:54:28.216 SCRIPT : {ECC61978EDCC2B5A}Missions/23_Campaign.conf (Conflict - Everon)
 */
const SECTION_PATTERN = /SCRIPT\s*:\s*(.+ scenarios) \(\d+ entr/i;
const MISSION_PATTERN = /SCRIPT\s*:\s*(\{[0-9A-Fa-f]{16}\}\S+\.conf)(?:\s+\((.+)\))?\s*$/;

export function parseMissionList(logContent: string): ParsedMission[] {
  const missions: ParsedMission[] = [];
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
        gameMode: null,
        playerCount: null,
        source: currentSource,
      });
    }
  }
  return missions;
}

/**
 * Extracts the scenarios the server itself reported at boot from its
 * console.log. Cached briefly; a fresh boot log always carries the listing
 * near the top, so the head of the file is enough.
 */
export class MissionCatalog {
  private cache: { missions: ParsedMission[]; fetchedAt: string; expiresAt: number } | null = null;

  constructor(
    private readonly provider: GameServerProvider,
    private readonly resolveLogPath: LogPathResolver,
    private readonly providerServerId: string,
  ) {}

  async list(force = false): Promise<{ missions: ParsedMission[]; fetchedAt: string | null }> {
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

function dedupe(missions: MissionInfo[]): MissionInfo[] {
  const seen = new Set<string>();
  const result: MissionInfo[] = [];
  for (const mission of missions) {
    if (seen.has(mission.scenarioId)) continue;
    seen.add(mission.scenarioId);
    result.push(mission);
  }
  return result;
}

/**
 * Builds the mission picker: one list of the vanilla scenarios, then one group
 * per installed mod that ships scenarios.
 *
 * Scenario ids come from the Workshop v2 `scenarios[].gameId` field, which is
 * an actual id rather than something scraped out of prose, and a mod is asked
 * for scenarios based on its reported `scenarioCount` rather than a tag
 * heuristic — so mods that ship missions without tagging themselves as
 * scenario mods are no longer missed.
 */
export class MissionsService {
  constructor(
    private readonly workshop: WorkshopCache,
    private readonly catalog: MissionCatalog | null,
  ) {}

  async list(installedMods: readonly ReforgerConfigMod[]): Promise<MissionsResponse> {
    const fromLog = this.catalog
      ? await this.catalog.list().catch(() => ({ missions: [], fetchedAt: null }))
      : { missions: [] as ParsedMission[], fetchedAt: null };

    const logOfficial = fromLog.missions.filter((mission) => mission.source === 'official');
    const logOther = fromLog.missions.filter((mission) => mission.source !== 'official');

    const groups: MissionGroup[] = [
      {
        id: 'official',
        label: 'Official (vanilla)',
        kind: 'official',
        // The server's own listing wins on naming; the bundled set fills in
        // whatever a rotated log no longer mentions.
        missions: dedupe([...logOfficial, ...OFFICIAL_MISSIONS]).sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      },
    ];

    const incompleteModIds: string[] = [];
    const modIds = installedMods.map((mod) => mod.modId.toUpperCase());
    const details = await Promise.all(modIds.map((id) => this.workshop.tryGetMod(id)));

    for (let index = 0; index < modIds.length; index += 1) {
      const modId = modIds[index]!;
      const detail = details[index];
      if (!detail) {
        incompleteModIds.push(modId);
        continue;
      }
      if (detail.scenarioCount === 0) continue;
      const scenarios = await this.workshop.getScenarios(modId);
      if (scenarios.length === 0) {
        // Reported scenarios we could not enumerate — say so rather than
        // silently showing a shorter list than the server has.
        if (detail.scenarioCount > 0) incompleteModIds.push(modId);
        continue;
      }
      groups.push({
        id: modId,
        label: detail.name,
        kind: 'mod',
        missions: scenarios.map((scenario) => ({
          scenarioId: scenario.scenarioId,
          name: scenario.name,
          gameMode: scenario.gameMode,
          playerCount: scenario.playerCount,
        })),
      });
    }

    // Anything the server reported that no group covers (mods the Workshop
    // does not know about, hand-installed missions).
    const covered = new Set(
      groups.flatMap((group) => group.missions.map((mission) => mission.scenarioId)),
    );
    const uncovered = logOther.filter((mission) => !covered.has(mission.scenarioId));
    if (uncovered.length > 0) {
      groups.push({
        id: 'server-log',
        label: 'Reported by the server',
        kind: 'mod',
        missions: dedupe(uncovered),
      });
    }

    return {
      groups: groups.filter((group) => group.missions.length > 0),
      incompleteModIds,
      fetchedAt: new Date().toISOString(),
    };
  }
}
