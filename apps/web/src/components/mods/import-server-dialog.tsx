import { useMemo, useState } from 'react';
import type { WorkshopServerSummary } from '@reforger-panel/shared';
import { useWorkshopServerMods, useWorkshopServers } from '../../api/hooks.js';
import { formatBytes } from '../../lib/format.js';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  SearchInput,
  SegmentedControl,
  Spinner,
  StatusBadge,
} from '../ui.js';
import { Icon } from '../icons.js';
import type { DraftMod } from './changeset.js';

type Mode = 'merge' | 'replace';

/**
 * Copies a modlist off a live Arma Reforger server, so a community setup can
 * be reproduced without hunting down and adding ninety mods by hand.
 *
 * Nothing is written here — the result lands in the staged changeset, which is
 * reviewed and applied like any other edit.
 */
export function ImportServerDialog({
  open,
  onClose,
  currentIds,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  currentIds: ReadonlySet<string>;
  onImport: (mods: DraftMod[], mode: Mode) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<WorkshopServerSummary | null>(null);
  const [mode, setMode] = useState<Mode>('merge');

  const servers = useWorkshopServers(query, open && selected === null);
  const serverMods = useWorkshopServerMods(selected?.id ?? null);

  const diff = useMemo(() => {
    const mods = serverMods.data?.mods ?? [];
    const incoming = mods.map((mod): DraftMod => ({
      modId: mod.id,
      name: mod.name,
      ...(mod.version ? { version: mod.version } : {}),
    }));
    const added = incoming.filter((mod) => !currentIds.has(mod.modId));
    const shared = incoming.filter((mod) => currentIds.has(mod.modId));
    const removed = [...currentIds].filter((id) => !incoming.some((mod) => mod.modId === id));
    const addedBytes = mods
      .filter((mod) => !currentIds.has(mod.id))
      .reduce((sum, mod) => sum + (mod.sizeBytes ?? 0), 0);
    return { incoming, added, shared, removed, addedBytes };
  }, [serverMods.data?.mods, currentIds]);

  const close = () => {
    setSelected(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      width="lg"
      title="Import a modlist from a server"
      description="Search the live Arma Reforger server browser, then stage its mods."
      footer={
        selected && (
          <>
            <Button icon="chevron-left" onClick={() => setSelected(null)}>
              Back to search
            </Button>
            <Button
              variant="accent"
              icon="plus"
              disabled={
                serverMods.isLoading ||
                (mode === 'merge' ? diff.added.length === 0 : diff.incoming.length === 0)
              }
              onClick={() => {
                onImport(diff.incoming, mode);
                close();
              }}
            >
              {mode === 'merge'
                ? `Stage ${diff.added.length} new mod${diff.added.length === 1 ? '' : 's'}`
                : `Replace list with ${diff.incoming.length}`}
            </Button>
          </>
        )
      }
    >
      {!selected ? (
        <div className="space-y-3">
          <SearchInput
            autoFocus
            value={query}
            onChange={setQuery}
            placeholder="Server name, e.g. HOGS OF WAR"
          />
          {query.trim().length < 2 ? (
            <EmptyState
              icon="search"
              title="Search for a server by name"
              hint="Only servers that actually run mods are listed."
            />
          ) : servers.isLoading ? (
            <Spinner label="Searching the server browser…" />
          ) : servers.error ? (
            <EmptyState icon="alert" title="The server browser is unavailable right now" />
          ) : (servers.data?.servers.length ?? 0) === 0 ? (
            <EmptyState title="No servers matched that name" />
          ) : (
            <ul className="divide-y divide-graphite-800 rounded-sm border border-graphite-700">
              {servers.data!.servers.map((server) => (
                <li key={server.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(server)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-graphite-850"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-zinc-100">{server.name}</p>
                      <p className="numeric mt-0.5 flex flex-wrap gap-x-3 text-2xs text-slate-dim">
                        <span>
                          {server.players}/{server.maxPlayers} players
                        </span>
                        <span>{server.modCount} mods</span>
                        {server.region && <span>{server.region}</span>}
                        {server.scenarioName && (
                          <span className="truncate">{server.scenarioName}</span>
                        )}
                      </p>
                    </div>
                    <StatusBadge status={server.online ? 'online' : 'offline'} compact />
                    <Icon name="chevron-right" className="h-4 w-4 text-slate-faint" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-sm border border-graphite-700 bg-graphite-950 px-3 py-2.5">
            <p className="truncate text-sm text-zinc-100">{selected.name}</p>
            <p className="numeric mt-0.5 text-2xs text-slate-dim">
              {selected.modCount} mods · {selected.players}/{selected.maxPlayers} players
              {selected.scenarioName ? ` · ${selected.scenarioName}` : ''}
            </p>
          </div>

          <SegmentedControl<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'merge', label: 'Merge — add what is missing' },
              { value: 'replace', label: 'Replace — mirror exactly' },
            ]}
          />

          {serverMods.isLoading ? (
            <Spinner label="Reading the server's mod list…" />
          ) : serverMods.error ? (
            <EmptyState icon="alert" title="Could not read that server's mod list" />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="To add" value={diff.added.length} tone="ok" />
                <Stat label="Already installed" value={diff.shared.length} tone="neutral" />
                <Stat
                  label={mode === 'replace' ? 'To remove' : 'Kept (not on that server)'}
                  value={diff.removed.length}
                  tone={mode === 'replace' ? 'danger' : 'neutral'}
                />
              </div>

              {diff.addedBytes > 0 && (
                <p className="numeric text-xs text-slate-dim">
                  Approximately {formatBytes(diff.addedBytes)} of new downloads.
                  {(serverMods.data?.unresolvedCount ?? 0) > 0 &&
                    ` ${serverMods.data!.unresolvedCount} mod sizes are unknown.`}
                </p>
              )}

              <div className="max-h-64 overflow-y-auto rounded-sm border border-graphite-700">
                <ul className="divide-y divide-graphite-800">
                  {diff.incoming.map((mod) => {
                    const isNew = !currentIds.has(mod.modId);
                    return (
                      <li key={mod.modId} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                        <Badge tone={isNew ? 'ok' : 'neutral'}>{isNew ? 'new' : 'have'}</Badge>
                        <span className="min-w-0 flex-1 truncate text-zinc-200">{mod.name}</span>
                        <span className="numeric shrink-0 text-slate-dim">
                          {mod.version ?? 'latest'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'ok' | 'danger' | 'neutral';
}) {
  const tones = {
    ok: 'text-ok-400',
    danger: 'text-danger-400',
    neutral: 'text-zinc-200',
  } as const;
  return (
    <div className="rounded-sm border border-graphite-700 bg-graphite-950 px-3 py-2">
      <p className={`numeric text-lg font-semibold ${tones[tone]}`}>{value}</p>
      <p className="text-2xs text-slate-dim">{label}</p>
    </div>
  );
}
