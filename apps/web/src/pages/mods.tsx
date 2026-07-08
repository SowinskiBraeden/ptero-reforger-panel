import { useState } from 'react';
import type { CurrentUser, ReforgerConfigMod, WorkshopModDetail } from '@reforger-panel/shared';
import { api } from '../api/client.js';
import {
  useServerMods,
  useServers,
  useSetServerMods,
  useWorkshopMod,
  useWorkshopSearch,
} from '../api/hooks.js';
import { formatRelativeTime } from '../lib/format.js';
import { Button, Card, EmptyState, ModImage, Spinner } from '../components/ui.js';

const COMMON_WORKSHOP_TAGS = [
  'WEAPONS',
  'VEHICLES',
  'MISSIONS',
  'EQUIPMENT',
  'GAMEPLAY',
  'MISC',
  'QUALITY OF LIFE',
] as const;

const WORKSHOP_SORTS = [
  { value: 'popularity', label: 'Popular' },
  { value: 'newest', label: 'Newest' },
  { value: 'subscribers', label: 'Subscribers' },
  { value: 'version_size', label: 'Size' },
] as const;

export function ModsPage({ user }: { user: CurrentUser }) {
  const { data: serversData } = useServers();
  const slug = serversData?.servers[0]?.slug;
  if (!slug) return <Spinner />;
  return <ModsBody slug={slug} user={user} />;
}

function sameMods(a: ReforgerConfigMod[], b: ReforgerConfigMod[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function ModsBody({ slug, user }: { slug: string; user: CurrentUser }) {
  const canManage = user.capabilities.includes('mods.manage');
  const { data, isLoading, error, refetch } = useServerMods(slug);
  const save = useSetServerMods(slug);
  const [draft, setDraft] = useState<ReforgerConfigMod[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedModId, setSelectedModId] = useState<string | null>(null);

  const serverMods = data?.mods ?? [];
  const mods = draft ?? serverMods;
  const dirty = draft !== null && !sameMods(draft, serverMods);
  const installedIds = new Set(mods.map((mod) => mod.modId.toUpperCase()));

  const addMod = (mod: ReforgerConfigMod) => {
    if (installedIds.has(mod.modId.toUpperCase())) return;
    setMessage(null);
    setDraft([...mods, mod]);
  };

  const removeMod = (modId: string) => {
    setMessage(null);
    setDraft(mods.filter((mod) => mod.modId !== modId));
  };

  const saveMods = () => {
    setMessage(null);
    save.mutate(mods, {
      onSuccess: (result) => {
        setDraft(null);
        setMessage(
          `Saved to config.json — ${result.added} added, ${result.removed} removed. ` +
            'Restart the server to apply.',
        );
        void refetch();
      },
      onError: (saveError) => setMessage(saveError.message),
    });
  };

  return (
    <div className="w-full space-y-5">
      <div>
        <h1 className="page-title">Mods</h1>
        <p className="page-kicker">
          Review the live server mod list, stage changes, and pull metadata from the Reforger
          Workshop before saving config.json.
        </p>
      </div>

      <Card
        title="Server mods (config.json)"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {data && !dirty && (
              <span className="text-xs text-slate-dim">
                fetched {formatRelativeTime(data.fetchedAt)}
              </span>
            )}
            {dirty && (
              <>
                <span className="text-xs text-warn-400">unsaved changes</span>
                <Button onClick={() => setDraft(null)} disabled={save.isPending}>
                  Discard
                </Button>
                <Button variant="accent" onClick={saveMods} disabled={save.isPending}>
                  {save.isPending ? 'Saving…' : 'Save to server'}
                </Button>
              </>
            )}
          </div>
        }
      >
        {isLoading ? (
          <Spinner label="Downloading config.json…" />
        ) : error ? (
          <p className="text-sm text-danger-400">{error.message}</p>
        ) : mods.length === 0 ? (
          <EmptyState
            title="No mods installed"
            hint={canManage ? 'Add mods from the Workshop below.' : 'The server runs vanilla.'}
          />
        ) : (
          <ul className="grid max-h-72 gap-1.5 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
            {mods.map((mod) => (
              <li
                key={mod.modId}
                className="flex items-center justify-between rounded-md border border-graphite-800 bg-graphite-950/20 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-200">
                    {mod.name ?? mod.modId}
                  </p>
                  <p className="font-mono text-xs text-slate-dim">
                    {mod.modId}
                    {mod.version ? ` · v${mod.version}` : ' · latest version'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button onClick={() => setSelectedModId(mod.modId)}>View</Button>
                  {canManage && (
                    <Button variant="danger" onClick={() => removeMod(mod.modId)}>
                      Remove
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {message && <p className="mt-3 text-xs text-accent-400">{message}</p>}
        <p className="mt-3 text-xs text-slate-dim">
          Changes are written directly to the server's config.json (a config.json.bak backup is
          kept) and take effect on the next server restart.
        </p>
      </Card>

      <WorkshopBrowser
        canManage={canManage}
        installedIds={installedIds}
        onAdd={addMod}
        selectedModId={selectedModId}
        setSelectedModId={setSelectedModId}
      />
    </div>
  );
}

function WorkshopBrowser({
  canManage,
  installedIds,
  onAdd,
  selectedModId,
  setSelectedModId,
}: {
  canManage: boolean;
  installedIds: Set<string>;
  onAdd: (mod: ReforgerConfigMod) => void;
  selectedModId: string | null;
  setSelectedModId: (id: string | null) => void;
}) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [sort, setSort] = useState<(typeof WORKSHOP_SORTS)[number]['value']>('popularity');
  const [page, setPage] = useState(1);
  const [addingId, setAddingId] = useState<string | null>(null);
  const effectiveQuery = [query, activeTag].filter(Boolean).join(' ');
  const { data, isFetching, error } = useWorkshopSearch(effectiveQuery, page, sort);

  // Adding needs the mod's version, which only the detail endpoint provides.
  const addFromWorkshop = async (modId: string, fallbackName: string) => {
    setAddingId(modId);
    try {
      const detail = await api.get<WorkshopModDetail>(`/api/workshop/mods/${modId}`);
      onAdd({
        modId: detail.id,
        name: detail.name || fallbackName,
        ...(detail.version ? { version: detail.version } : {}),
      });
    } catch {
      onAdd({ modId, name: fallbackName });
    } finally {
      setAddingId(null);
    }
  };

  return (
    <Card title="Workshop">
      <form
        className="mb-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_180px_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSelectedModId(null);
          setQuery(input.trim());
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Search the Reforger Workshop… (empty shows the front page)"
          className="input min-w-0 flex-1"
        />
        <select
          value={sort}
          onChange={(event) => {
            setPage(1);
            setSort(event.target.value as (typeof WORKSHOP_SORTS)[number]['value']);
          }}
          className="input"
        >
          {WORKSHOP_SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Button variant="accent" type="submit" disabled={isFetching}>
          {isFetching ? 'Loading…' : 'Search'}
        </Button>
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-slate-dim">Tags</span>
        {COMMON_WORKSHOP_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => {
              setPage(1);
              setSelectedModId(null);
              setActiveTag(activeTag === tag ? null : tag);
            }}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              activeTag === tag
                ? 'border-accent-500/50 bg-accent-500/15 text-accent-400'
                : 'border-graphite-700 bg-graphite-950/20 text-slate-ink hover:border-graphite-600 hover:text-zinc-200'
            }`}
          >
            {tag}
          </button>
        ))}
        {activeTag && (
          <button
            type="button"
            onClick={() => {
              setActiveTag(null);
              setPage(1);
            }}
            className="text-xs text-slate-dim hover:text-zinc-200"
          >
            Clear tag
          </button>
        )}
      </div>

      {error && <p className="text-sm text-danger-400">{error.message}</p>}
      {!data && !error && <Spinner label="Loading Workshop mods…" />}
      {data && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_430px]">
          <div className={`min-w-0 ${isFetching ? 'opacity-60' : ''} transition-opacity`}>
            <p className="mb-2 text-xs text-slate-dim">
              {effectiveQuery
                ? `${data.meta.totalMods.toLocaleString()} results for “${effectiveQuery}”`
                : `${data.meta.totalMods.toLocaleString()} Workshop mods`}{' '}
              · page {data.meta.currentPage} of {data.meta.totalPages}
            </p>
            <ul className="max-h-[62vh] space-y-1.5 overflow-y-auto pr-1">
              {data.mods.map((mod) => {
                const installed = installedIds.has(mod.id.toUpperCase());
                return (
                  <li key={mod.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedModId(mod.id)}
                      className={`flex min-w-0 flex-1 items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                        selectedModId === mod.id
                          ? 'border-accent-600/60 bg-accent-600/10'
                          : 'border-graphite-800 bg-graphite-950/20 hover:border-graphite-600'
                      }`}
                    >
                      <ModImage src={mod.imageUrl} className="h-10 w-10" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-zinc-200">{mod.name}</span>
                        <span className="block truncate text-xs text-slate-dim">
                          {mod.author} · {mod.size ?? '—'} · {mod.rating ?? '—'}
                        </span>
                      </span>
                    </button>
                    {canManage && (
                      <Button
                        variant="accent"
                        disabled={installed || addingId === mod.id}
                        title={installed ? 'Already in the mod list' : undefined}
                        onClick={() => void addFromWorkshop(mod.id, mod.name)}
                      >
                        {installed ? 'Added' : addingId === mod.id ? '…' : 'Add'}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex items-center gap-2">
              <Button disabled={page <= 1 || isFetching} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                disabled={page >= data.meta.totalPages || isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
          <ModDetailPanel
            modId={selectedModId}
            canManage={canManage}
            installedIds={installedIds}
            onAdd={onAdd}
            onTagSelect={(tag) => {
              setActiveTag(tag);
              setPage(1);
              setSelectedModId(null);
            }}
          />
        </div>
      )}
    </Card>
  );
}

function ModDetailPanel({
  modId,
  canManage,
  installedIds,
  onAdd,
  onTagSelect,
}: {
  modId: string | null;
  canManage: boolean;
  installedIds: Set<string>;
  onAdd: (mod: ReforgerConfigMod) => void;
  onTagSelect: (tag: string) => void;
}) {
  const { data: mod, isLoading } = useWorkshopMod(modId);
  const [addingDepId, setAddingDepId] = useState<string | null>(null);

  const addDep = async (depId: string, depName: string) => {
    setAddingDepId(depId);
    try {
      const detail = await api.get<WorkshopModDetail>(`/api/workshop/mods/${depId}`);
      onAdd({
        modId: detail.id,
        name: detail.name || depName,
        ...(detail.version ? { version: detail.version } : {}),
      });
    } catch {
      onAdd({ modId: depId, name: depName });
    } finally {
      setAddingDepId(null);
    }
  };

  if (!modId) {
    return (
      <div className="rounded-md border border-dashed border-graphite-700 bg-graphite-950/20 p-6">
        <EmptyState title="Select a mod" hint="Mod details load from the Workshop API." />
      </div>
    );
  }
  if (isLoading || !mod) return <Spinner />;
  const installed = installedIds.has(mod.id.toUpperCase());
  return (
    <div className="max-h-[62vh] min-w-0 overflow-y-auto rounded-md border border-graphite-800 bg-graphite-950/20 p-4 xl:sticky xl:top-24">
      <div className="flex items-start gap-4">
        <ModImage src={mod.imageUrl} className="h-20 w-20" />
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-zinc-100">{mod.name}</h3>
          <p className="text-xs text-slate-ink">
            by {mod.author} · v{mod.version ?? '—'} · game {mod.gameVersion ?? '—'}
          </p>
          <p className="text-xs text-slate-dim">
            {mod.downloads?.toLocaleString() ?? '—'} downloads · {mod.rating ?? '—'} rating ·{' '}
            {mod.size ?? '—'}
          </p>
        </div>
      </div>
      {mod.summary && <p className="mt-3 text-sm text-zinc-300">{mod.summary}</p>}
      {mod.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {mod.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onTagSelect(tag)}
              className="rounded-full border border-graphite-700 bg-graphite-900 px-2 py-0.5 text-xs text-slate-ink hover:border-accent-500/50 hover:text-accent-400"
            >
              {tag}
            </button>
          ))}
        </div>
      )}
      {mod.dependencies.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs uppercase tracking-wider text-warn-400">Dependencies</p>
          <ul className="space-y-1">
            {mod.dependencies.map((dep) => {
              const depInstalled = dep.id ? installedIds.has(dep.id.toUpperCase()) : false;
              return (
                <li
                  key={dep.id ?? dep.name}
                  className="flex items-center justify-between gap-2 rounded border border-graphite-800 bg-graphite-950/20 px-2.5 py-1.5"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm text-zinc-300">{dep.name}</span>
                    {depInstalled && (
                      <span className="shrink-0 text-xs text-accent-400">Installed</span>
                    )}
                  </span>
                  {canManage && dep.id && !depInstalled && (
                    <Button
                      variant="accent"
                      disabled={addingDepId === dep.id}
                      onClick={() => dep.id && void addDep(dep.id, dep.name)}
                    >
                      {addingDepId === dep.id ? '…' : 'Add'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="mt-4 flex items-center gap-2">
        {canManage && (
          <Button
            variant="accent"
            disabled={installed}
            onClick={() =>
              onAdd({
                modId: mod.id,
                name: mod.name,
                ...(mod.version ? { version: mod.version } : {}),
              })
            }
          >
            {installed ? 'Already added' : 'Add to server'}
          </Button>
        )}
        {mod.workshopUrl && (
          <a
            href={mod.workshopUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent-400 hover:underline"
          >
            Open in Workshop ↗
          </a>
        )}
      </div>
    </div>
  );
}
