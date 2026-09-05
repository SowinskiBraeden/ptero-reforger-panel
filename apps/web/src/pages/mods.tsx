import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CurrentUser,
  ModOverviewEntry,
  ModResolveResponse,
  WorkshopModPreview,
} from '@reforger-panel/shared';
import {
  useModsOverview,
  usePrimaryServer,
  useResolveMods,
  useSetServerMods,
} from '../api/hooks.js';
import { formatRelativeTime } from '../lib/format.js';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Notice,
  PageHeader,
  SegmentedControl,
  Spinner,
  useToast,
} from '../components/ui.js';
import { BrowsePanel } from '../components/mods/browse-panel.js';
import { ChangesetBar } from '../components/mods/changeset-bar.js';
import { ImportServerDialog } from '../components/mods/import-server-dialog.js';
import { InstalledPanel } from '../components/mods/installed-panel.js';
import { ModDetailDialog } from '../components/mods/mod-detail-dialog.js';
import { VersionDialog } from '../components/mods/version-dialog.js';
import {
  computeChanges,
  draftFromOverview,
  mergeModLists,
  normalizeId,
  removeMod,
  setModVersion,
  upsertMod,
  type DraftMod,
} from '../components/mods/changeset.js';

type Tab = 'installed' | 'browse';

const RESOLVE_DEBOUNCE_MS = 600;

export function ModsPage({ user }: { user: CurrentUser }) {
  const server = usePrimaryServer();
  if (!server) return <Spinner />;
  return <ModsBody slug={server.slug} user={user} />;
}

function ModsBody({ slug, user }: { slug: string; user: CurrentUser }) {
  const toast = useToast();
  const canManage = user.capabilities.includes('mods.manage');

  const overviewQuery = useModsOverview(slug);
  const save = useSetServerMods(slug);
  const resolve = useResolveMods(slug);

  const [tab, setTab] = useState<Tab>('installed');
  const [draft, setDraft] = useState<DraftMod[] | null>(null);
  const [baselineRevision, setBaselineRevision] = useState<string | null>(null);
  const [detailModId, setDetailModId] = useState<string | null>(null);
  const [versionTarget, setVersionTarget] = useState<ModOverviewEntry | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [resolution, setResolution] = useState<ModResolveResponse | null>(null);

  const overview = overviewQuery.data;

  /**
   * The draft is seeded from the server once. It is deliberately NOT resynced
   * on every refetch — that would silently throw away staged edits while the
   * overview polls during cache warm-up.
   */
  useEffect(() => {
    if (!overview) return;
    setDraft((current) => (current === null ? draftFromOverview(overview.mods) : current));
    setBaselineRevision((current) => current ?? overview.revision);
  }, [overview]);

  const baseline = useMemo(() => (overview ? draftFromOverview(overview.mods) : []), [overview]);

  const entryById = useMemo(
    () => new Map((overview?.mods ?? []).map((entry) => [entry.modId, entry])),
    [overview],
  );

  const nameOf = useCallback(
    (modId: string, fallback?: string | null) =>
      entryById.get(modId)?.workshop?.name ?? entryById.get(modId)?.configName ?? fallback ?? modId,
    [entryById],
  );

  const changes = useMemo(
    () => (draft ? computeChanges(baseline, draft, nameOf) : []),
    [baseline, draft, nameOf],
  );

  const draftIds = useMemo(() => new Set((draft ?? []).map((mod) => mod.modId)), [draft]);

  /**
   * Whenever the plan changes, ask the server to expand it into its full
   * dependency closure. Debounced so a burst of clicks costs one request.
   */
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  useEffect(() => {
    if (!draft || changes.length === 0) {
      setResolution(null);
      return;
    }
    const timer = setTimeout(() => {
      resolveRef.current.mutate(draft, {
        onSuccess: setResolution,
        onError: () => setResolution(null),
      });
    }, RESOLVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, changes.length]);

  if (overviewQuery.isLoading || !overview || draft === null) {
    return <Spinner label="Reading the server's mod list…" />;
  }
  if (overviewQuery.error) {
    return (
      <EmptyState
        icon="alert"
        title="Could not read the mod list"
        hint={overviewQuery.error.message}
        action={
          <Button icon="refresh" onClick={() => void overviewQuery.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const mutate = (next: DraftMod[]) => setDraft(next);

  const addMod = (mod: { id: string; name: string; version: string | null }) => {
    if (!canManage) return;
    mutate(
      upsertMod(draft, {
        modId: normalizeId(mod.id),
        name: mod.name,
        // Leave unpinned so the server takes the current version at boot; the
        // API fills the concrete version in on write.
      }),
    );
  };

  const updateAll = () => {
    const updatable = overview.mods.filter(
      (entry) =>
        entry.updateAvailable && entry.workshop?.latestVersion && draftIds.has(entry.modId),
    );
    if (updatable.length === 0) {
      toast('Every mod is already on its latest version', 'ok');
      return;
    }
    let next = draft;
    for (const entry of updatable) {
      next = setModVersion(next, entry.modId, entry.workshop!.latestVersion!);
    }
    mutate(next);
    toast(`Staged ${updatable.length} version update${updatable.length === 1 ? '' : 's'}`);
  };

  const addAllDependencies = () => {
    const missing = resolution?.addedDependencies ?? [];
    let next = draft;
    for (const dependency of missing) {
      next = upsertMod(next, { modId: dependency.modId, name: dependency.name ?? undefined });
    }
    mutate(next);
  };

  const discard = () => {
    setDraft(draftFromOverview(overview.mods));
    setResolution(null);
  };

  const apply = () => {
    save.mutate(
      { mods: draft, expectedRevision: baselineRevision ?? overview.revision },
      {
        onSuccess: (result) => {
          setDraft(null);
          setBaselineRevision(null);
          setResolution(null);
          void overviewQuery.refetch();
          toast(
            `Saved: ${result.added} added, ${result.changed} re-versioned, ${result.removed} removed. Restart to apply.`,
            'ok',
          );
        },
        onError: (error) => toast(error.message, 'danger'),
      },
    );
  };

  const refresh = () => {
    setDraft(null);
    setBaselineRevision(null);
    void overviewQuery.refetch();
  };

  return (
    <div className="w-full space-y-4">
      <PageHeader
        title="Mods"
        kicker={
          <>
            {draft.length} mod{draft.length === 1 ? '' : 's'} in config.json
            {overview.updatesAvailable > 0 && ` · ${overview.updatesAvailable} update available`}
            {' · read '}
            {formatRelativeTime(overview.fetchedAt)}
          </>
        }
        actions={
          canManage && (
            <>
              <Button icon="refresh" onClick={refresh} title="Re-read config.json and metadata" />
              <Button icon="download" onClick={() => setImportOpen(true)}>
                Import from server
              </Button>
              <Button
                icon="arrow-up"
                onClick={updateAll}
                disabled={overview.updatesAvailable === 0}
              >
                Update all
              </Button>
              <Button
                icon="trash"
                variant="danger"
                onClick={() => setClearOpen(true)}
                disabled={draft.length === 0}
              >
                Clear modlist
              </Button>
            </>
          )
        }
      />

      {overview.orphanedMission && (
        <Notice tone="warn" title="The configured mission is no longer available">
          <code className="font-mono">{overview.orphanedMission.scenarioId}</code> is not offered by
          the base game or by anything currently installed. Pick a different mission on the Mission
          page, or re-add the mod that provided it.
        </Notice>
      )}

      <SegmentedControl<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'installed', label: 'Installed', icon: 'package', count: draft.length },
          { value: 'browse', label: 'Browse Workshop', icon: 'search' },
        ]}
      />

      <Card padded={false} className="p-4">
        {tab === 'installed' ? (
          <InstalledPanel
            overview={overview}
            draft={draft}
            canManage={canManage}
            onOpen={setDetailModId}
            onRemove={(modId) => mutate(removeMod(draft, modId))}
            onPinVersion={setVersionTarget}
            onAddDependency={(modId, name) => mutate(upsertMod(draft, { modId, name }))}
          />
        ) : (
          <BrowsePanel
            installedIds={draftIds}
            canManage={canManage}
            onAdd={(mod: WorkshopModPreview) =>
              addMod({ id: mod.id, name: mod.name, version: mod.version })
            }
            onRemove={(modId) => mutate(removeMod(draft, modId))}
            onOpen={setDetailModId}
          />
        )}
      </Card>

      <ChangesetBar
        changes={changes}
        resolution={resolution}
        resolving={resolve.isPending}
        applying={save.isPending}
        onDiscard={discard}
        onApply={apply}
        onAddDependencies={addAllDependencies}
      />

      <ModDetailDialog
        modId={detailModId}
        onClose={() => setDetailModId(null)}
        installed={detailModId !== null && draftIds.has(detailModId)}
        canManage={canManage}
        onAdd={() => {
          if (!detailModId) return;
          mutate(upsertMod(draft, { modId: detailModId }));
          setDetailModId(null);
        }}
        onRemove={() => {
          if (!detailModId) return;
          mutate(removeMod(draft, detailModId));
          setDetailModId(null);
        }}
      />

      <VersionDialog
        open={versionTarget !== null}
        modId={versionTarget?.modId ?? null}
        modName={versionTarget ? nameOf(versionTarget.modId) : ''}
        currentVersion={
          versionTarget
            ? (draft.find((mod) => mod.modId === versionTarget.modId)?.version ?? null)
            : null
        }
        latestVersion={versionTarget?.workshop?.latestVersion ?? null}
        onClose={() => setVersionTarget(null)}
        onSelect={(version) => {
          if (!versionTarget) return;
          mutate(setModVersion(draft, versionTarget.modId, version));
          setVersionTarget(null);
        }}
      />

      <ImportServerDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        currentIds={draftIds}
        onImport={(mods, mode) => {
          mutate(mergeModLists(draft, mods, mode));
          toast(
            mode === 'merge'
              ? 'Missing mods staged from that server'
              : 'Modlist staged to mirror that server exactly',
          );
        }}
      />

      <ConfirmDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={() => {
          mutate([]);
          setClearOpen(false);
        }}
        title="Clear the whole modlist?"
        confirmLabel="Clear all mods"
        body={
          <>
            This stages the removal of all {draft.length} mods, returning the server to vanilla.
            Nothing is written until you press <strong>Apply to server</strong>, and the change
            takes effect on the next restart.
          </>
        }
      />
    </div>
  );
}
