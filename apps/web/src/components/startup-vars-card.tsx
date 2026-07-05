import { useState } from 'react';
import { useStartupVariables, useUpdateStartupVariable } from '../api/hooks.js';
import { Button, Card, EmptyState, Spinner } from './ui.js';

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
  const [message, setMessage] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const isSecret = (name: string) => /password|token|secret|key/i.test(name);

  const saveVariable = (envVariable: string) => {
    const value = edits[envVariable];
    if (value === undefined) return;
    setMessage(null);
    update.mutate(
      { key: envVariable, value },
      {
        onSuccess: () => {
          setEdits((prev) => {
            const next = { ...prev };
            delete next[envVariable];
            return next;
          });
          setMessage(`${envVariable} saved — applies on the next restart.`);
        },
        onError: (updateError) => setMessage(updateError.message),
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
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-graphite-800 px-3.5 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-200">
                      {variable.name}{' '}
                      <code className="ml-1 text-xs text-slate-dim">{variable.envVariable}</code>
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
                        onClick={() => setRevealed({ ...revealed, [variable.envVariable]: !shown })}
                      >
                        {shown ? 'Hide' : 'Show'}
                      </Button>
                    )}
                    {variable.isEditable ? (
                      edited !== undefined &&
                      edited !== variable.value && (
                        <Button
                          variant="accent"
                          disabled={update.isPending}
                          onClick={() => saveVariable(variable.envVariable)}
                        >
                          Save
                        </Button>
                      )
                    ) : (
                      <span className="text-xs text-slate-dim">read-only</span>
                    )}
                  </div>
                </li>
              );
            })}
        </ul>
      )}
      {message && <p className="mt-3 text-xs text-accent-400">{message}</p>}
      <p className="mt-3 text-xs text-slate-dim">
        These are the same variables as Pterodactyl's Startup tab (server passwords live here, not
        in config.json). Changes apply on the next server restart.
      </p>
    </Card>
  );
}
