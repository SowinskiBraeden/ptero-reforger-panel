import { useMemo, useState } from 'react';
import type { ConfigEntry, ConfigPatchOp, StartupMirror } from '@reforger-panel/shared';
import { useConfigTree, usePatchConfig } from '../../api/hooks.js';
import { formatRelativeTime } from '../../lib/format.js';
import {
  Badge,
  Button,
  EmptyState,
  Notice,
  SearchInput,
  Spinner,
  Toggle,
  useToast,
} from '../ui.js';
import { Icon } from '../icons.js';

type EditValue = string | number | boolean | null;

/**
 * Searchable editor over every key config.json actually contains.
 *
 * The panel used to reach only eleven hardcoded fields, and submitted all of
 * them on every save. Here each row tracks its own dirty state and only the
 * touched paths are sent, against the revision the page was loaded at — so a
 * stale tab is rejected instead of quietly reverting someone else's edit.
 */
export function ConfigKeyEditor({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  const toast = useToast();
  const { data, isLoading, error, refetch } = useConfigTree(slug, canEdit);
  const patch = usePatchConfig(slug);

  const [query, setQuery] = useState('');
  const [edits, setEdits] = useState<Map<string, EditValue>>(new Map());
  const [writeStartupVars, setWriteStartupVars] = useState(true);

  const entries = data?.entries ?? [];
  const mirrorByPath = useMemo(() => {
    const map = new Map<string, StartupMirror>();
    for (const mirror of data?.mirrors ?? []) map.set(mirror.configPath, mirror);
    return map;
  }, [data?.mirrors]);

  const visible = useMemo(() => {
    if (!query.trim()) return entries;
    const needle = query.trim().toLowerCase();
    return entries.filter(
      (entry) =>
        entry.path.toLowerCase().includes(needle) ||
        String(entry.value ?? '')
          .toLowerCase()
          .includes(needle),
    );
  }, [entries, query]);

  const setEdit = (path: string, value: EditValue) => {
    setEdits((current) => {
      const next = new Map(current);
      next.set(path, value);
      return next;
    });
  };

  const clearEdit = (path: string) => {
    setEdits((current) => {
      const next = new Map(current);
      next.delete(path);
      return next;
    });
  };

  const ops: ConfigPatchOp[] = useMemo(
    () => [...edits.entries()].map(([path, value]) => ({ path, value })),
    [edits],
  );

  const touchedMirrors = ops
    .map((op) => mirrorByPath.get(op.path))
    .filter((mirror): mirror is StartupMirror => mirror !== undefined);

  const conflictingMirrors = (data?.mirrors ?? []).filter((mirror) => mirror.conflict);

  const apply = () => {
    patch.mutate(
      { ops, expectedRevision: data?.revision, writeStartupVars },
      {
        onSuccess: (result) => {
          setEdits(new Map());
          void refetch();
          toast(
            result.changedPaths.length === 0
              ? 'No changes to save.'
              : `Saved ${result.changedPaths.length} value${result.changedPaths.length === 1 ? '' : 's'}${
                  result.startupVarsWritten.length > 0
                    ? ` (also mirrored to ${result.startupVarsWritten.join(', ')})`
                    : ''
                }. Restart to apply.`,
            'ok',
          );
        },
        onError: (mutationError) => toast(mutationError.message, 'danger'),
      },
    );
  };

  if (!canEdit) {
    return <EmptyState icon="lock" title="Configuration editing is restricted to admins" />;
  }
  if (isLoading) return <Spinner label="Downloading config.json…" />;
  if (error || !data) {
    return (
      <EmptyState
        icon="alert"
        title="Could not read config.json"
        hint={error?.message}
        action={
          <Button icon="refresh" onClick={() => void refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Find any key, e.g. view distance, rcon, battlEye…"
          className="w-full sm:w-96"
        />
        <span className="numeric ml-auto text-2xs text-slate-dim">
          {visible.length} of {entries.length} keys · read {formatRelativeTime(data.fetchedAt)}
        </span>
      </div>

      {conflictingMirrors.length > 0 && (
        <Notice tone="warn" title="Some values are also templated from startup variables">
          <p>
            This egg regenerates parts of config.json from Pterodactyl startup variables at boot.
            For these keys the file and the variable currently disagree, so the variable wins on the
            next restart:
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {conflictingMirrors.map((mirror) => (
              <li key={`${mirror.envVariable}-${mirror.configPath}`} className="font-mono text-2xs">
                {mirror.configPath} = {String(mirror.configValue ?? '—')} · {mirror.envVariable} ={' '}
                {mirror.startupValue || '—'}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {visible.length === 0 ? (
        <EmptyState title="No keys match that search" />
      ) : (
        <ul className="divide-y divide-graphite-800 overflow-hidden rounded-md border border-graphite-700">
          {visible.map((entry) => (
            <KeyRow
              key={entry.path}
              entry={entry}
              edited={edits.has(entry.path)}
              editValue={edits.get(entry.path) ?? null}
              mirror={mirrorByPath.get(entry.path)}
              onChange={(value) => setEdit(entry.path, value)}
              onReset={() => clearEdit(entry.path)}
            />
          ))}
        </ul>
      )}

      {ops.length > 0 && (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-graphite-600 bg-graphite-900/95 px-4 py-3 backdrop-blur">
          <span className="text-xs text-zinc-200">
            {ops.length} value{ops.length === 1 ? '' : 's'} changed
          </span>
          {touchedMirrors.length > 0 && (
            <label className="flex items-center gap-2 text-2xs text-warn-400">
              <Toggle
                checked={writeStartupVars}
                onChange={setWriteStartupVars}
                label="Also write matching startup variables"
              />
              Also write {touchedMirrors.map((mirror) => mirror.envVariable).join(', ')} so the
              change survives a restart
            </label>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button onClick={() => setEdits(new Map())} disabled={patch.isPending}>
              Discard
            </Button>
            <Button variant="accent" icon="upload" onClick={apply} loading={patch.isPending}>
              Apply to server
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function KeyRow({
  entry,
  edited,
  editValue,
  mirror,
  onChange,
  onReset,
}: {
  entry: ConfigEntry;
  edited: boolean;
  editValue: EditValue;
  mirror: StartupMirror | undefined;
  onChange: (value: EditValue) => void;
  onReset: () => void;
}) {
  const value = edited ? editValue : entry.value;
  const removed = edited && editValue === null;
  const readOnly = entry.type === 'array';

  return (
    <li
      className={`flex flex-wrap items-center gap-3 px-3 py-2 ${edited ? 'bg-accent-600/[0.06]' : 'hover:bg-graphite-850/50'}`}
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-mono text-xs text-zinc-100">
          <span className="truncate">{entry.path}</span>
          {edited && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" />}
          {mirror && (
            <Badge tone="warn" icon="alert" title={`Also set by ${mirror.envVariable}`}>
              {mirror.envVariable}
            </Badge>
          )}
        </p>
        {removed && (
          <p className="mt-0.5 text-2xs text-danger-400">
            Key will be removed — the game default applies.
          </p>
        )}
      </div>

      <div className="flex w-full shrink-0 items-center gap-2 sm:w-72">
        {readOnly ? (
          <span className="truncate font-mono text-2xs text-slate-dim" title={entry.raw}>
            {entry.raw}
          </span>
        ) : entry.type === 'boolean' ? (
          <select
            value={removed ? '' : String(value)}
            onChange={(event) =>
              onChange(event.target.value === '' ? null : event.target.value === 'true')
            }
            className="input"
          >
            <option value="true">true</option>
            <option value="false">false</option>
            <option value="">(remove key)</option>
          </select>
        ) : entry.type === 'number' ? (
          <input
            type="number"
            value={removed ? '' : String(value ?? '')}
            placeholder="(removed)"
            onChange={(event) =>
              onChange(event.target.value === '' ? null : Number(event.target.value))
            }
            className="input numeric"
          />
        ) : (
          <input
            value={removed ? '' : String(value ?? '')}
            placeholder="(removed)"
            onChange={(event) => onChange(event.target.value)}
            className="input font-mono text-xs"
          />
        )}

        {!readOnly && (
          <button
            type="button"
            title={edited ? 'Revert to the value on the server' : 'Remove this key'}
            onClick={() => (edited ? onReset() : onChange(null))}
            className="shrink-0 rounded-sm border border-graphite-700 p-1.5 text-slate-dim transition-colors hover:text-zinc-100"
          >
            <Icon name={edited ? 'refresh' : 'trash'} className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </li>
  );
}
