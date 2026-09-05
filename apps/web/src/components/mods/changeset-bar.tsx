import type { ModResolveResponse } from '@reforger-panel/shared';
import { formatBytes } from '../../lib/format.js';
import { Badge, Button } from '../ui.js';
import { Icon } from '../icons.js';
import type { Change } from './changeset.js';

const KIND_META: Record<
  Change['kind'],
  { icon: 'plus' | 'minus' | 'arrow-up'; tone: string; label: string }
> = {
  add: { icon: 'plus', tone: 'text-ok-400', label: 'add' },
  remove: { icon: 'minus', tone: 'text-danger-400', label: 'remove' },
  version: { icon: 'arrow-up', tone: 'text-warn-400', label: 'version' },
};

/**
 * The staged plan. Everything the user has done since loading the page is
 * shown as a reviewable diff, and Apply writes config.json exactly once.
 */
export function ChangesetBar({
  changes,
  resolution,
  resolving,
  applying,
  onDiscard,
  onApply,
  onAddDependencies,
}: {
  changes: readonly Change[];
  resolution: ModResolveResponse | null;
  resolving: boolean;
  applying: boolean;
  onDiscard: () => void;
  onApply: () => void;
  onAddDependencies: () => void;
}) {
  if (changes.length === 0) return null;

  const added = changes.filter((change) => change.kind === 'add').length;
  const removed = changes.filter((change) => change.kind === 'remove').length;
  const reversioned = changes.filter((change) => change.kind === 'version').length;
  const missingDependencies = resolution?.addedDependencies ?? [];

  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-graphite-600 bg-graphite-900/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-xs">
            <span className="eyebrow">Pending changes</span>
            {added > 0 && <Badge tone="ok">{added} added</Badge>}
            {reversioned > 0 && <Badge tone="warn">{reversioned} re-versioned</Badge>}
            {removed > 0 && <Badge tone="danger">{removed} removed</Badge>}
            {resolution?.totalSizeBytes ? (
              <span className="numeric text-slate-dim">
                {formatBytes(resolution.totalSizeBytes)} total after apply
              </span>
            ) : null}
            {resolving && <span className="text-slate-dim">checking dependencies…</span>}
          </p>

          <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto pr-2">
            {changes.map((change) => {
              const meta = KIND_META[change.kind];
              return (
                <li
                  key={`${change.kind}-${change.modId}`}
                  className="flex items-center gap-2 text-xs"
                >
                  <Icon name={meta.icon} className={`h-3 w-3 ${meta.tone}`} />
                  <span className="min-w-0 flex-1 truncate text-zinc-200">{change.name}</span>
                  <span className="numeric shrink-0 text-2xs text-slate-dim">
                    {change.kind === 'version'
                      ? `${change.from ?? 'latest'} → ${change.to ?? 'latest'}`
                      : (change.to ?? change.from ?? 'latest')}
                  </span>
                </li>
              );
            })}
          </ul>

          {missingDependencies.length > 0 && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-2xs text-warn-400">
              <Icon name="alert" className="h-3.5 w-3.5" />
              {missingDependencies.length} required dependenc
              {missingDependencies.length === 1 ? 'y is' : 'ies are'} not in the list
              <Button size="sm" variant="subtle" icon="plus" onClick={onAddDependencies}>
                Add all
              </Button>
            </p>
          )}

          {resolution && resolution.unresolvedIds.length > 0 && (
            <p className="mt-1 text-2xs text-slate-dim">
              {resolution.unresolvedIds.length} mod
              {resolution.unresolvedIds.length === 1 ? '' : 's'} could not be checked against the
              Workshop; they will be written as-is.
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-2xs text-slate-dim sm:inline">
            Applies on the next restart
          </span>
          <Button onClick={onDiscard} disabled={applying}>
            Discard all
          </Button>
          <Button variant="accent" icon="upload" onClick={onApply} loading={applying}>
            Apply to server
          </Button>
        </div>
      </div>
    </div>
  );
}
