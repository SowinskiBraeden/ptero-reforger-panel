import { useMemo, useState } from 'react';
import type { ModOverviewEntry, ModsOverviewResponse } from '@reforger-panel/shared';
import { formatBytes } from '../../lib/format.js';
import {
  Badge,
  Button,
  EmptyState,
  ModImage,
  Notice,
  SearchInput,
  SegmentedControl,
} from '../ui.js';
import { Icon } from '../icons.js';
import type { DraftMod } from './changeset.js';

type Filter = 'all' | 'updates' | 'issues';

/**
 * The installed modlist, joined with Workshop metadata server-side so the page
 * paints in one request rather than one request per mod.
 */
export function InstalledPanel({
  overview,
  draft,
  canManage,
  onOpen,
  onRemove,
  onPinVersion,
  onAddDependency,
}: {
  overview: ModsOverviewResponse;
  draft: readonly DraftMod[];
  canManage: boolean;
  onOpen: (modId: string) => void;
  onRemove: (modId: string) => void;
  onPinVersion: (entry: ModOverviewEntry) => void;
  onAddDependency: (modId: string, name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const draftIds = useMemo(() => new Set(draft.map((mod) => mod.modId)), [draft]);

  /**
   * Rows come from the staged draft, not the server list, so a mod added in
   * this session appears immediately and one queued for removal disappears.
   */
  const rows = useMemo(() => {
    const byId = new Map(overview.mods.map((entry) => [entry.modId, entry]));
    return draft.map((mod) => ({
      modId: mod.modId,
      draft: mod,
      entry: byId.get(mod.modId),
    }));
  }, [draft, overview.mods]);

  const issueCount = overview.mods.filter(
    (entry) =>
      draftIds.has(entry.modId) &&
      (entry.missingDependencies.some((dep) => !draftIds.has(dep.id)) ||
        entry.workshop?.obsolete ||
        entry.workshop === null),
  ).length;

  const visible = rows.filter(({ modId, draft: mod, entry }) => {
    const name = entry?.workshop?.name ?? mod.name ?? modId;
    if (query && !`${name} ${modId}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (filter === 'updates') return Boolean(entry?.updateAvailable);
    if (filter === 'issues') {
      return Boolean(
        entry === undefined ||
        entry.workshop === null ||
        entry.workshop.obsolete ||
        entry.missingDependencies.some((dep) => !draftIds.has(dep.id)),
      );
    }
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Filter installed mods…"
          className="w-full sm:w-72"
        />
        <SegmentedControl<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: draft.length },
            { value: 'updates', label: 'Updates', count: overview.updatesAvailable },
            { value: 'issues', label: 'Issues', count: issueCount },
          ]}
        />
        <div className="numeric ml-auto text-2xs text-slate-dim">
          {overview.totalSizeBytes ? `${formatBytes(overview.totalSizeBytes)} installed` : null}
        </div>
      </div>

      {overview.warming && (
        <Notice tone="info">
          Loading Workshop metadata for {overview.mods.length} mods. Names, versions and
          dependencies fill in as they arrive.
        </Notice>
      )}

      {overview.unresolvedIds.length > 0 && !overview.warming && (
        <Notice tone="warn" title={`${overview.unresolvedIds.length} mods could not be identified`}>
          They may be private, delisted, or the Workshop index may be missing them. They are still
          installed and are left untouched.
        </Notice>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon="package"
          title={draft.length === 0 ? 'The server runs vanilla' : 'No mods match this filter'}
          hint={
            draft.length === 0
              ? 'Add mods from the Browse tab, or import a modlist from another server.'
              : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-graphite-800 overflow-hidden rounded-md border border-graphite-700">
          {visible.map(({ modId, draft: mod, entry }) => (
            <ModRow
              key={modId}
              modId={modId}
              draft={mod}
              entry={entry}
              draftIds={draftIds}
              canManage={canManage}
              onOpen={() => onOpen(modId)}
              onRemove={() => onRemove(modId)}
              onPinVersion={() => entry && onPinVersion(entry)}
              onAddDependency={onAddDependency}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ModRow({
  modId,
  draft,
  entry,
  draftIds,
  canManage,
  onOpen,
  onRemove,
  onPinVersion,
  onAddDependency,
}: {
  modId: string;
  draft: DraftMod;
  entry: ModOverviewEntry | undefined;
  draftIds: ReadonlySet<string>;
  canManage: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onPinVersion: () => void;
  onAddDependency: (modId: string, name: string) => void;
}) {
  const workshop = entry?.workshop ?? null;
  const name = workshop?.name ?? draft.name ?? entry?.configName ?? modId;
  const pinned = draft.version ?? null;
  const latest = workshop?.latestVersion ?? null;
  const outdated = Boolean(pinned && latest && pinned !== latest);
  const missing = (entry?.missingDependencies ?? []).filter((dep) => !draftIds.has(dep.id));
  const blockers = (entry?.requiredBy ?? []).filter((id) => draftIds.has(id));

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5 hover:bg-graphite-850/50">
      <button
        type="button"
        onClick={onOpen}
        className="group flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <ModImage src={workshop?.imageUrl ?? null} className="h-9 w-14" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm text-zinc-100 group-hover:text-accent-300">
            {name}
            {workshop?.obsolete && <Badge tone="danger">obsolete</Badge>}
            {workshop === null && entry !== undefined && <Badge tone="warn">unknown</Badge>}
          </p>
          <p className="truncate font-mono text-2xs text-slate-faint">
            {workshop?.author ? `${workshop.author} · ` : ''}
            {modId}
          </p>
        </div>
      </button>

      <div className="numeric hidden w-24 shrink-0 text-right text-2xs text-slate-dim sm:block">
        {workshop?.sizeBytes ? formatBytes(workshop.sizeBytes) : '—'}
      </div>

      <button
        type="button"
        disabled={!canManage || !entry}
        onClick={onPinVersion}
        title={pinned ? `Pinned to ${pinned}` : 'Tracking latest'}
        className="numeric flex shrink-0 items-center gap-1.5 rounded-sm border border-graphite-700 bg-graphite-950 px-2 py-1 text-2xs text-zinc-200 transition-colors enabled:hover:border-graphite-500 disabled:opacity-50"
      >
        {pinned ?? 'latest'}
        {outdated && (
          <>
            <Icon name="chevron-right" className="h-3 w-3 text-warn-400" />
            <span className="text-warn-400">{latest}</span>
          </>
        )}
        {canManage && entry && <Icon name="chevron-down" className="h-3 w-3 text-slate-faint" />}
      </button>

      {canManage && (
        <Button
          size="sm"
          variant="ghost"
          icon="trash"
          onClick={onRemove}
          title={
            blockers.length > 0
              ? `Still required by ${blockers.length} installed mod(s)`
              : 'Remove from the mod list'
          }
        />
      )}

      {(missing.length > 0 || blockers.length > 0) && (
        <div className="flex w-full flex-wrap items-center gap-2 pl-[4.25rem] text-2xs">
          {missing.length > 0 && (
            <>
              <span className="text-warn-400">
                Missing {missing.length} dependenc{missing.length === 1 ? 'y' : 'ies'}:
              </span>
              {missing.map((dependency) => (
                <button
                  key={dependency.id}
                  type="button"
                  disabled={!canManage}
                  onClick={() => onAddDependency(dependency.id, dependency.name)}
                  className="rounded-xs border border-warn-400/40 bg-warn-400/10 px-1.5 py-0.5 text-warn-400 transition-colors enabled:hover:bg-warn-400/20 disabled:opacity-60"
                >
                  + {dependency.name}
                </button>
              ))}
            </>
          )}
          {blockers.length > 0 && (
            <span className="text-slate-dim">
              Required by {blockers.length} installed mod{blockers.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}
    </li>
  );
}
