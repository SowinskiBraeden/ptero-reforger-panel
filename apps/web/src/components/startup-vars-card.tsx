import { useState } from 'react';
import { useStartupVariables, useUpdateStartupVariable } from '../api/hooks.js';
import { STARTUP_MIRROR_HINTS } from './config/mirror-hints.js';
import { Badge, Button, Card, EmptyState, Spinner, useToast } from './ui.js';

/**
 * Pterodactyl egg startup variables (passwords, launch options, …). Values
 * are only visible to owner/server admin; changes apply on the next restart.
 */
// Controlled elsewhere in the panel (mission dropdown) or intentionally not
// exposed; hidden here to avoid duplicate/confusing inputs.
const HIDDEN_VARIABLES = new Set(['SCENARIO_ID', 'PUBLIC_ADDRESS']);

export function StartupVarsCard({ slug }: { slug: string }) {
  const { data, isLoading, error } = useStartupVariables(slug, true);
  const update = useUpdateStartupVariable(slug);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const toast = useToast();

  const isSecret = (name: string) => /password|token|secret|key/i.test(name);

  const saveVariable = (envVariable: string) => {
    const value = edits[envVariable];
    if (value === undefined) return;
    update.mutate(
      { key: envVariable, value },
      {
        onSuccess: () => {
          setEdits((prev) => {
            const next = { ...prev };
            delete next[envVariable];
            return next;
          });
          toast(`${envVariable} saved — applies on the next restart.`, 'ok');
        },
        onError: (updateError) => toast(updateError.message, 'danger'),
      },
    );
  };

  return (
    <Card title="Startup variables (Pterodactyl)">
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <p className="text-sm text-danger-400">{error.message}</p>
      ) : !data || data.variables.length === 0 ? (
        <EmptyState title="No startup variables" hint="The egg exposes none for this server." />
      ) : (
        <ul className="space-y-3">
          {data.variables
            .filter((variable) => !HIDDEN_VARIABLES.has(variable.envVariable))
            .map((variable) => {
              const edited = edits[variable.envVariable];
              const secret = isSecret(variable.envVariable) || isSecret(variable.name);
              const shown = revealed[variable.envVariable] ?? false;
              return (
                <li
                  key={variable.envVariable}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-graphite-800 bg-graphite-950/40 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-100">
                      {variable.name}
                      <code className="font-mono text-2xs text-slate-dim">
                        {variable.envVariable}
                      </code>
                      {STARTUP_MIRROR_HINTS[variable.envVariable] && (
                        <Badge
                          tone="warn"
                          icon="alert"
                          title={`Also written into config.json at ${STARTUP_MIRROR_HINTS[variable.envVariable]}`}
                        >
                          templates {STARTUP_MIRROR_HINTS[variable.envVariable]}
                        </Badge>
                      )}
                    </p>
                    {variable.description && (
                      <p className="mt-0.5 text-xs text-slate-dim">{variable.description}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <input
                      type={secret && !shown ? 'password' : 'text'}
                      className="input w-48"
                      disabled={!variable.isEditable || update.isPending}
                      value={edited ?? variable.value}
                      placeholder={variable.defaultValue || 'empty'}
                      onChange={(event) =>
                        setEdits({ ...edits, [variable.envVariable]: event.target.value })
                      }
                    />
                    {secret && (
                      <Button
                        size="sm"
                        onClick={() => setRevealed({ ...revealed, [variable.envVariable]: !shown })}
                      >
                        {shown ? 'Hide' : 'Show'}
                      </Button>
                    )}
                    {variable.isEditable ? (
                      edited !== undefined &&
                      edited !== variable.value && (
                        <Button
                          size="sm"
                          variant="accent"
                          icon="upload"
                          loading={update.isPending}
                          onClick={() => saveVariable(variable.envVariable)}
                        >
                          Save
                        </Button>
                      )
                    ) : (
                      <Badge>read-only</Badge>
                    )}
                  </div>
                </li>
              );
            })}
        </ul>
      )}
      <p className="mt-3 text-2xs leading-5 text-slate-dim">
        These are the same variables as Pterodactyl&rsquo;s Startup tab; server passwords live here
        rather than in config.json. Variables marked as templating a config path are re-applied to
        config.json when the container boots, so they win over a direct file edit. Changes apply on
        the next server restart.
      </p>
    </Card>
  );
}
