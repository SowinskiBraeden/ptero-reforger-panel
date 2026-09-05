import { useState } from 'react';
import { WORKSHOP_SORTS, type WorkshopModPreview, type WorkshopSort } from '@reforger-panel/shared';
import { useWorkshopSearch } from '../../api/hooks.js';
import { formatBytes } from '../../lib/format.js';
import { Badge, Button, EmptyState, ModImage, SearchInput, Skeleton } from '../ui.js';
import { Icon } from '../icons.js';

/**
 * The upstream index rejects comma-separated tags, so filtering is one tag at
 * a time. These are the tags that actually appear on Reforger Workshop mods.
 */
const TAGS = [
  'SCENARIOS_MP',
  'SCENARIOS_SP',
  'WEAPONS',
  'VEHICLES',
  'CHARACTERS',
  'TERRAINS',
  'SYSTEMS',
  'PROPS',
  'EFFECTS',
  'MISC',
] as const;

const SORT_LABELS: Record<WorkshopSort, string> = {
  popularity: 'Popular',
  'most-rated': 'Most rated',
  'highest-rated': 'Highest rated',
  subscribers: 'Subscribers',
  newest: 'Newest',
  created: 'Recently created',
  'recently-updated': 'Recently updated',
  largest: 'Largest',
  name: 'Name',
};

export function BrowsePanel({
  installedIds,
  canManage,
  onAdd,
  onRemove,
  onOpen,
}: {
  installedIds: ReadonlySet<string>;
  canManage: boolean;
  onAdd: (mod: WorkshopModPreview) => void;
  onRemove: (modId: string) => void;
  onOpen: (modId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<WorkshopSort>('popularity');
  const [tag, setTag] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const search = useWorkshopSearch({ query, page, sort, tag: tag ?? undefined });
  const mods = search.data?.mods ?? [];
  const meta = search.data?.meta;

  const reset =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
    };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onChange={reset(setQuery)}
          placeholder="Search the Workshop…"
          className="w-full sm:w-80"
        />
        <select
          value={sort}
          onChange={(event) => reset(setSort)(event.target.value as WorkshopSort)}
          className="input w-auto"
        >
          {WORKSHOP_SORTS.map((value) => (
            <option key={value} value={value}>
              {SORT_LABELS[value]}
            </option>
          ))}
        </select>
        {meta && (
          <span className="numeric ml-auto text-2xs text-slate-dim">
            {meta.totalMods.toLocaleString()} mods
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TAGS.map((value) => {
          const active = tag === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => reset(setTag)(active ? null : value)}
              className={`rounded-xs border px-2 py-0.5 text-2xs font-semibold transition-colors ${
                active
                  ? 'border-accent-600 bg-accent-600/20 text-accent-300'
                  : 'border-graphite-700 bg-graphite-850 text-slate-dim hover:text-zinc-200'
              }`}
            >
              {value}
            </button>
          );
        })}
      </div>

      {search.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="panel-card space-y-2 p-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      ) : search.error ? (
        <EmptyState
          icon="alert"
          title="The Workshop index is unavailable"
          hint="reforgermods.net did not answer. Installed mods are unaffected."
          action={
            <Button icon="refresh" onClick={() => void search.refetch()}>
              Retry
            </Button>
          }
        />
      ) : mods.length === 0 ? (
        <EmptyState
          title="No mods matched"
          hint="Try a different search or clear the tag filter."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {mods.map((mod) => (
            <ModCard
              key={mod.id}
              mod={mod}
              installed={installedIds.has(mod.id.toUpperCase())}
              canManage={canManage}
              onAdd={() => onAdd(mod)}
              onRemove={() => onRemove(mod.id.toUpperCase())}
              onOpen={() => onOpen(mod.id.toUpperCase())}
            />
          ))}
        </div>
      )}

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            icon="chevron-left"
            disabled={page <= 1 || search.isFetching}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </Button>
          <span className="numeric text-xs text-slate-dim">
            Page {meta.currentPage} of {meta.totalPages}
          </span>
          <Button
            disabled={page >= meta.totalPages || search.isFetching}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

function ModCard({
  mod,
  installed,
  canManage,
  onAdd,
  onRemove,
  onOpen,
}: {
  mod: WorkshopModPreview;
  installed: boolean;
  canManage: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onOpen: () => void;
}) {
  return (
    <article className="panel-card flex flex-col overflow-hidden">
      <button type="button" onClick={onOpen} className="group text-left">
        <ModImage
          src={mod.imageUrl}
          className="h-28 w-full rounded-none border-0 border-b border-graphite-700"
        />
        <div className="p-3">
          <h3 className="truncate text-sm font-medium text-zinc-100 group-hover:text-accent-300">
            {mod.name}
          </h3>
          <p className="truncate text-xs text-slate-dim">{mod.author}</p>
        </div>
      </button>

      <div className="mt-auto space-y-2 px-3 pb-3">
        <div className="numeric flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-slate-dim">
          {mod.version && <span>v{mod.version}</span>}
          <span>
            {mod.sizeBytes ? formatBytes(mod.sizeBytes) : (mod.sizeText ?? 'size unknown')}
          </span>
          {mod.rating !== null && mod.rating > 0 && (
            <span className="flex items-center gap-1">
              <Icon name="check" className="h-3 w-3 text-ok-400" />
              {Math.round(mod.rating * 100)}%
            </span>
          )}
          {mod.subscriberCount ? <span>{mod.subscriberCount.toLocaleString()} subs</span> : null}
        </div>

        {mod.obsolete && <Badge tone="danger">obsolete</Badge>}

        {canManage &&
          (installed ? (
            <Button size="sm" variant="danger" icon="minus" onClick={onRemove} className="w-full">
              Remove
            </Button>
          ) : (
            <Button size="sm" variant="accent" icon="plus" onClick={onAdd} className="w-full">
              Add
            </Button>
          ))}
      </div>
    </article>
  );
}
