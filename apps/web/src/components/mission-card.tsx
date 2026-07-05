import { useState } from 'react';
import { useConfiguration, useMissions, useSetPerformanceSettings } from '../api/hooks.js';
import { Button, Card, Spinner } from './ui.js';
import { shortScenario } from './widgets.js';

function missionSourceLabel(source: string): string {
  if (source === 'official') return '';
  if (source.startsWith('mod: ')) return `Mod: ${source.slice(5)}`;
  return source;
}

/**
 * Mission switcher. Options come from the scenario listing the server prints
 * at boot (requires the -listScenarios launch flag, standard on Reforger eggs).
 */
export function MissionCard({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  const { data: config, refetch } = useConfiguration(slug);
  const { data: missions } = useMissions(slug);
  const save = useSetPerformanceSettings(slug);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!config) {
    return (
      <Card title="Mission">
        <Spinner />
      </Card>
    );
  }

  const current = config.config.scenarioId;
  const currentName =
    missions?.missions.find((m) => m.scenarioId === current)?.name ?? shortScenario(current);
  const value = selected ?? current;
  const dirty = value !== current;

  const submit = () => {
    setMessage(null);
    save.mutate(
      { scenarioId: value },
      {
        onSuccess: () => {
          setSelected(null);
          setMessage('Mission saved to config.json — restart the server to switch.');
          void refetch();
        },
        onError: (error) => setMessage(error.message),
      },
    );
  };

  return (
    <Card
      title="Mission"
      action={
        canEdit &&
        dirty && (
          <div className="flex items-center gap-2">
            <Button onClick={() => setSelected(null)} disabled={save.isPending}>
              Discard
            </Button>
            <Button variant="accent" onClick={submit} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save to server'}
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-medium text-zinc-100">{currentName}</p>
          <p className="truncate font-mono text-xs text-slate-dim" title={current}>
            {shortScenario(current)}
          </p>
        </div>
        {canEdit &&
          (missions && missions.missions.length > 0 ? (
            <select
              value={value}
              onChange={(event) => {
                setMessage(null);
                setSelected(event.target.value);
              }}
              className="input max-w-xs"
            >
              {!missions.missions.some((m) => m.scenarioId === current) && (
                <option value={current}>{currentName} (current)</option>
              )}
              {missions.missions.map((mission) => (
                <option key={mission.scenarioId} value={mission.scenarioId}>
                  {mission.name}
                  {missionSourceLabel(mission.source)
                    ? ` [${missionSourceLabel(mission.source)}]`
                    : ''}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-slate-dim">
              No scenario listing found in the current log — make sure the server runs with
              -listScenarios and has booted recently.
            </p>
          ))}
      </div>
      {message && <p className="mt-3 text-xs text-accent-400">{message}</p>}
    </Card>
  );
}
