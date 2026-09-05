import { useMemo, useState } from 'react';
import type { MissionInfo } from '@reforger-panel/shared';
import { useConfiguration, useMissions, useSetPerformanceSettings } from '../api/hooks.js';
import { Badge, Button, Card, EmptyState, Notice, SearchInput, Spinner, useToast } from './ui.js';
import { Icon } from './icons.js';

const SCENARIO_PATTERN = /^\{[0-9A-Fa-f]{16}\}[^\0\r\n]+\.conf$/;

/** Display form of a scenario id: just the file name, e.g. "23_Campaign.conf". */
export function shortScenario(scenarioId: string): string {
  const slash = scenarioId.lastIndexOf('/');
  return slash >= 0 ? scenarioId.slice(slash + 1) : scenarioId;
}

/**
 * Mission picker.
 *
 * Scenario discovery is now reliable: the vanilla list is bundled and merged
 * with whatever the server prints at boot, and modded scenarios come from the
 * Workshop v2 `scenarios[].gameId` field rather than being scraped out of prose.
 * The raw id input is kept, but demoted to a fallback.
 */
export function MissionCard({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  const toast = useToast();
  const { data: config, refetch: refetchConfig } = useConfiguration(slug);
  const {
    data: missions,
    isLoading: missionsLoading,
    refetch: refetchMissions,
  } = useMissions(slug);
  const save = useSetPerformanceSettings(slug);

  const [query, setQuery] = useState('');
  const [manual, setManual] = useState('');
  const [showManual, setShowManual] = useState(false);

  const current = config?.config.scenarioId ?? '';

  const groups = useMemo(() => {
    if (!missions) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return missions.groups;
    return missions.groups
      .map((group) => ({
        ...group,
        missions: group.missions.filter(
          (mission) =>
            mission.name.toLowerCase().includes(needle) ||
            mission.scenarioId.toLowerCase().includes(needle) ||
            (mission.gameMode ?? '').toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.missions.length > 0);
  }, [missions, query]);

  const known = useMemo(
    () =>
      new Set(
        (missions?.groups ?? []).flatMap((group) =>
          group.missions.map((mission) => mission.scenarioId),
        ),
      ),
    [missions],
  );

  const currentMission = useMemo(() => {
    for (const group of missions?.groups ?? []) {
      const match = group.missions.find((mission) => mission.scenarioId === current);
      if (match) return { mission: match, groupLabel: group.label };
    }
    return null;
  }, [missions, current]);

  const apply = (scenarioId: string) => {
    if (!SCENARIO_PATTERN.test(scenarioId)) {
      toast('That does not look like a scenario id ({16 hex}Missions/….conf).', 'danger');
      return;
    }
    save.mutate(
      {
        settings: { scenarioId },
        expectedRevision: config?.revision,
        writeStartupVars: true,
      },
      {
        onSuccess: () => {
          setManual('');
          void refetchConfig();
          toast('Mission saved to config.json. Restart the server to switch.', 'ok');
        },
        onError: (error) => toast(error.message, 'danger'),
      },
    );
  };

  if (!config) {
    return (
      <Card title="Mission">
        <Spinner />
      </Card>
    );
  }

  return (
    <Card
      title="Mission"
      action={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            onClick={() => void refetchMissions()}
            title="Re-scan available missions"
          />
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={() => setShowManual((open) => !open)}>
              {showManual ? 'Hide manual entry' : 'Enter an ID manually'}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-sm border border-graphite-700 bg-graphite-950 px-3 py-2.5">
          <p className="eyebrow">Currently configured</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-base text-zinc-50">
            {currentMission?.mission.name ?? shortScenario(current)}
            {currentMission && <Badge tone="accent">{currentMission.groupLabel}</Badge>}
            {currentMission?.mission.gameMode && <Badge>{currentMission.mission.gameMode}</Badge>}
          </p>
          <p className="mt-0.5 truncate font-mono text-2xs text-slate-faint" title={current}>
            {current || '(none set)'}
          </p>
        </div>

        {!missionsLoading && current && !known.has(current) && (
          <Notice tone="warn" title="Nothing installed provides this mission">
            The server is configured for a scenario the base game does not ship and no installed mod
            offers. It will fail to load it on the next restart — pick one below, or re-add the mod
            that provided it.
          </Notice>
        )}

        {(missions?.incompleteModIds.length ?? 0) > 0 && (
          <Notice tone="info">
            {missions!.incompleteModIds.length} installed mod
            {missions!.incompleteModIds.length === 1 ? "'s" : "s'"} scenarios could not be read from
            the Workshop, so this list may be incomplete.
          </Notice>
        )}

        {canEdit && showManual && (
          <div className="flex gap-2">
            <input
              value={manual}
              placeholder="{FDE33AFE2ED7875B}Missions/23_Campaign_Montignac.conf"
              onChange={(event) => setManual(event.target.value)}
              className="input font-mono text-xs"
            />
            <Button
              variant="accent"
              disabled={!manual.trim() || save.isPending}
              onClick={() => apply(manual.trim())}
            >
              Set
            </Button>
          </div>
        )}

        <SearchInput value={query} onChange={setQuery} placeholder="Search missions…" />

        {missionsLoading ? (
          <Spinner label="Reading available missions…" />
        ) : groups.length === 0 ? (
          <EmptyState
            icon="map"
            title={query ? 'No missions match that search' : 'No missions found'}
            hint={
              query
                ? undefined
                : 'Vanilla scenarios are always listed; modded scenarios come from the mods installed on this server.'
            }
          />
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <section key={group.id}>
                <p className="eyebrow mb-1.5 flex items-center gap-2">
                  <Icon
                    name={group.kind === 'official' ? 'map' : 'package'}
                    className="h-3.5 w-3.5"
                  />
                  {group.label}
                  <span className="numeric text-slate-faint">{group.missions.length}</span>
                </p>
                <ul className="divide-y divide-graphite-800 overflow-hidden rounded-sm border border-graphite-700">
                  {group.missions.map((mission) => (
                    <MissionRow
                      key={mission.scenarioId}
                      mission={mission}
                      active={mission.scenarioId === current}
                      canEdit={canEdit}
                      saving={save.isPending}
                      onSelect={() => apply(mission.scenarioId)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function MissionRow({
  mission,
  active,
  canEdit,
  saving,
  onSelect,
}: {
  mission: MissionInfo;
  active: boolean;
  canEdit: boolean;
  saving: boolean;
  onSelect: () => void;
}) {
  return (
    <li
      className={`flex flex-wrap items-center gap-3 px-3 py-2 ${active ? 'bg-accent-600/[0.09]' : 'hover:bg-graphite-850/50'}`}
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm text-zinc-100">
          {mission.name}
          {active && <Badge tone="accent">running</Badge>}
        </p>
        <p className="truncate font-mono text-2xs text-slate-faint">{mission.scenarioId}</p>
      </div>
      {mission.gameMode && <Badge>{mission.gameMode}</Badge>}
      {mission.playerCount ? (
        <span className="numeric text-2xs text-slate-dim">{mission.playerCount}p</span>
      ) : null}
      {canEdit && (
        <Button
          size="sm"
          variant={active ? 'subtle' : 'accent'}
          disabled={active || saving}
          onClick={onSelect}
        >
          {active ? 'Current' : 'Use'}
        </Button>
      )}
    </li>
  );
}
