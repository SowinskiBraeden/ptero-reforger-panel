import { describe, expect, it } from 'vitest';
import {
  hasScenarioTag,
  mergeMissions,
  parseMissionList,
  scenariosFromWorkshopMod,
} from './missions-catalog.js';

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
    expect(missions[0]).toEqual({
      scenarioId: '{ECC61978EDCC2B5A}Missions/23_Campaign.conf',
      name: 'Conflict - Everon',
      source: 'official',
    });
    expect(missions[3]).toEqual({
      scenarioId: '{ABCDEF0123456789}Missions/CustomOps.conf',
      name: 'Custom Ops',
      source: 'workshop',
    });
  });

  it('deduplicates repeated listings (multiple boots in one file)', () => {
    const missions = parseMissionList(`${LOG}\n${LOG}`);
    expect(missions).toHaveLength(4);
  });

  it('returns an empty list when no listing is present', () => {
    expect(parseMissionList('12:00:00.000 DEFAULT : nothing here')).toEqual([]);
  });
});

describe('workshop scenario helpers', () => {
  it('recognizes scenario tag variants from the workshop', () => {
    expect(hasScenarioTag(['SCENARIOS_MP'])).toBe(true);
    expect(hasScenarioTag(['scenario sp'])).toBe(true);
    expect(hasScenarioTag(['WEAPONS'])).toBe(false);
  });

  it('converts mod scenarios into mission entries', () => {
    const missions = scenariosFromWorkshopMod({
      id: 'ABC',
      name: 'Scenario Pack',
      author: 'Author',
      imageUrl: null,
      size: null,
      rating: null,
      workshopUrl: null,
      version: null,
      gameVersion: null,
      subscribers: null,
      downloads: null,
      createdAtText: null,
      lastModifiedText: null,
      summary: null,
      description: null,
      license: null,
      tags: [],
      dependencies: [],
      scenarios: [
        {
          name: 'Raid Night',
          description: null,
          scenarioId: '{1111111111111111}Missions/RaidNight.conf',
          gamemode: 'Coop',
          playerCount: 32,
          imageUrl: null,
        },
      ],
    });
    expect(missions).toEqual([
      {
        scenarioId: '{1111111111111111}Missions/RaidNight.conf',
        name: 'Raid Night',
        source: 'mod: Scenario Pack',
      },
    ]);
  });

  it('deduplicates mission groups while preserving first source', () => {
    const merged = mergeMissions(
      [{ scenarioId: 'same', name: 'From Log', source: 'workshop' }],
      [{ scenarioId: 'same', name: 'From Mod', source: 'mod: Pack' }],
      [{ scenarioId: 'other', name: 'Other', source: 'mod: Pack' }],
    );
    expect(merged).toEqual([
      { scenarioId: 'same', name: 'From Log', source: 'workshop' },
      { scenarioId: 'other', name: 'Other', source: 'mod: Pack' },
    ]);
  });
});
