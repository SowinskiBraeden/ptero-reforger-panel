import { describe, expect, it, vi } from 'vitest';
import type { WorkshopModDetail, WorkshopScenario } from '@reforger-panel/shared';
import type { WorkshopCache } from '../workshop/workshop-cache.js';
import {
  MissionsService,
  OFFICIAL_MISSIONS,
  OFFICIAL_SCENARIO_IDS,
  parseMissionList,
} from './missions-catalog.js';
import type { MissionCatalog, ParsedMission } from './missions-catalog.js';

// Verbatim shape from a real console.log (server runs with -listScenarios).
const LOG = [
  '12:54:28.215 SCRIPT       : --------------------------------------------------',
  '12:54:28.215 SCRIPT       : Official scenarios (3 entries)',
  '12:54:28.216 SCRIPT       : --------------------------------------------------',
  '12:54:28.216 SCRIPT       : {ECC61978EDCC2B5A}Missions/23_Campaign.conf (Conflict - Everon)',
  '12:54:28.216 SCRIPT       : {002AF7323E0129AF}Missions/Tutorial.conf (Training)',
  '12:54:28.217 SCRIPT       : {59AD59368755F41A}Missions/21_GM_Eden.conf (Game Master - Everon)',
  '12:54:29.000 SCRIPT       : Workshop scenarios (1 entries)',
  '12:54:29.001 SCRIPT       : {ABCDEF0123456789}Missions/CustomOps.conf (Custom Ops)',
  '12:54:30.000 DEFAULT      : something unrelated',
].join('\n');

describe('parseMissionList', () => {
  it('parses scenario ids, display names, and section sources', () => {
    const missions = parseMissionList(LOG);
    expect(missions).toHaveLength(4);
    expect(missions[0]).toMatchObject({
      scenarioId: '{ECC61978EDCC2B5A}Missions/23_Campaign.conf',
      name: 'Conflict - Everon',
      source: 'official',
    });
    expect(missions[3]).toMatchObject({
      scenarioId: '{ABCDEF0123456789}Missions/CustomOps.conf',
      name: 'Custom Ops',
      source: 'workshop',
    });
  });

  it('deduplicates repeated listings (multiple boots in one file)', () => {
    expect(parseMissionList(`${LOG}\n${LOG}`)).toHaveLength(4);
  });

  it('returns an empty list when no listing is present', () => {
    expect(parseMissionList('12:00:00.000 DEFAULT : nothing here')).toEqual([]);
  });
});

describe('OFFICIAL_MISSIONS', () => {
  it('covers the vanilla scenarios with well-formed ids', () => {
    expect(OFFICIAL_MISSIONS.length).toBeGreaterThan(15);
    for (const mission of OFFICIAL_MISSIONS) {
      expect(mission.scenarioId).toMatch(/^\{[0-9A-F]{16}\}Missions\/.+\.conf$/);
      expect(mission.name).not.toMatch(/^#AR-/);
    }
    expect(OFFICIAL_SCENARIO_IDS.has('{ECC61978EDCC2B5A}Missions/23_Campaign.conf')).toBe(true);
  });
});

function scenario(id: string, name: string): WorkshopScenario {
  return {
    scenarioId: id,
    name,
    gameMode: 'Campaign',
    author: null,
    description: null,
    playerCount: 64,
  };
}

function fakeWorkshop(mods: Record<string, { name: string; scenarios: WorkshopScenario[] }>) {
  return {
    tryGetMod: vi.fn(async (id: string) => {
      const mod = mods[id];
      if (!mod) return null;
      return {
        id,
        name: mod.name,
        scenarioCount: mod.scenarios.length,
        scenarios: mod.scenarios,
      } as unknown as WorkshopModDetail;
    }),
    getScenarios: vi.fn(async (id: string) => mods[id]?.scenarios ?? []),
  } as unknown as WorkshopCache;
}

function fakeCatalog(missions: ParsedMission[]): MissionCatalog {
  return {
    list: async () => ({ missions, fetchedAt: new Date().toISOString() }),
  } as MissionCatalog;
}

describe('MissionsService', () => {
  it('always offers the vanilla scenarios as one group', async () => {
    const service = new MissionsService(fakeWorkshop({}), null);
    const result = await service.list([]);
    const official = result.groups.find((group) => group.id === 'official')!;
    expect(official.kind).toBe('official');
    expect(official.missions.length).toBeGreaterThan(15);
  });

  it('adds one group per installed mod that ships scenarios', async () => {
    const workshop = fakeWorkshop({
      AAAA000000000001: {
        name: 'Scenario Pack',
        scenarios: [scenario('{1111111111111111}Missions/RaidNight.conf', 'Raid Night')],
      },
      BBBB000000000002: { name: 'Weapons Only', scenarios: [] },
    });
    const service = new MissionsService(workshop, null);
    const result = await service.list([
      { modId: 'aaaa000000000001' },
      { modId: 'BBBB000000000002' },
    ]);

    const modGroups = result.groups.filter((group) => group.kind === 'mod');
    expect(modGroups).toHaveLength(1);
    expect(modGroups[0]!.label).toBe('Scenario Pack');
    expect(modGroups[0]!.missions[0]).toEqual({
      scenarioId: '{1111111111111111}Missions/RaidNight.conf',
      name: 'Raid Night',
      gameMode: 'Campaign',
      playerCount: 64,
    });
  });

  it('reports mods it could not resolve rather than silently dropping them', async () => {
    const service = new MissionsService(fakeWorkshop({}), null);
    const result = await service.list([{ modId: 'CCCC000000000003' }]);
    expect(result.incompleteModIds).toEqual(['CCCC000000000003']);
  });

  it("prefers the server's own naming for official scenarios", async () => {
    const service = new MissionsService(
      fakeWorkshop({}),
      fakeCatalog([
        {
          scenarioId: '{ECC61978EDCC2B5A}Missions/23_Campaign.conf',
          name: 'Conflict - Everon (from log)',
          gameMode: null,
          playerCount: null,
          source: 'official',
        },
      ]),
    );
    const official = (await service.list([])).groups.find((group) => group.id === 'official')!;
    const everon = official.missions.find(
      (mission) => mission.scenarioId === '{ECC61978EDCC2B5A}Missions/23_Campaign.conf',
    )!;
    expect(everon.name).toBe('Conflict - Everon (from log)');
    // Only listed once, despite also being in the bundled set.
    expect(
      official.missions.filter((mission) => mission.scenarioId === everon.scenarioId),
    ).toHaveLength(1);
  });

  it('surfaces log-reported scenarios that no mod group covers', async () => {
    const service = new MissionsService(
      fakeWorkshop({}),
      fakeCatalog([
        {
          scenarioId: '{ABCDEF0123456789}Missions/CustomOps.conf',
          name: 'Custom Ops',
          gameMode: null,
          playerCount: null,
          source: 'workshop',
        },
      ]),
    );
    const fallback = (await service.list([])).groups.find((group) => group.id === 'server-log')!;
    expect(fallback.missions[0]!.name).toBe('Custom Ops');
  });
});
