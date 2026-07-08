import { useState } from 'react';
import { useConfiguration, useSetPerformanceSettings } from '../api/hooks.js';
import { Button, Card, Spinner } from './ui.js';
import { shortScenario } from './widgets.js';

const DEFAULT_SCENARIO_ID = '{FDE33AFE2ED7875B}Missions/23_Campaign_Montignac.conf';
const DEFAULT_SCENARIO_NAME = 'Campaign - Montignac (default)';

/**
 * Mission editor. Scenario discovery through the Workshop API is not reliable
 * enough for every mod, so the primary control is a manual scenario ID input.
 */
export function MissionCard({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  const { data: config, refetch } = useConfiguration(slug);
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
  const value = selected ?? current;
  const dirty = value !== current;

  const submit = (scenarioIdOverride?: string) => {
    setMessage(null);
    save.mutate(
      { scenarioId: scenarioIdOverride ?? value },
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
            <Button variant="accent" onClick={() => submit()} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save to server'}
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-4">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-medium text-zinc-100">{shortScenario(current)}</p>
          <p className="truncate font-mono text-xs text-slate-dim" title={current}>
            {current}
          </p>
        </div>
        {canEdit && (
          <div className="grid gap-2">
            <input
              value={value}
              onChange={(event) => {
                setMessage(null);
                setSelected(event.target.value);
              }}
              placeholder="{FDE33AFE2ED7875B}Missions/23_Campaign_Montignac.conf"
              className="input w-full font-mono text-xs"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => {
                  setMessage(null);
                  setSelected(DEFAULT_SCENARIO_ID);
                }}
                disabled={save.isPending}
              >
                Use {DEFAULT_SCENARIO_NAME}
              </Button>
              <Button
                variant="danger"
                onClick={() => submit(DEFAULT_SCENARIO_ID)}
                disabled={save.isPending || current === DEFAULT_SCENARIO_ID}
              >
                {save.isPending ? 'Saving…' : 'Reset to default'}
              </Button>
            </div>
          </div>
        )}
      </div>
      {message && <p className="mt-3 text-xs text-accent-400">{message}</p>}
    </Card>
  );
}
