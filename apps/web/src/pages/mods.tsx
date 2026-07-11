import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  CurrentUser,
  ModDependencyIssue,
  ModsCheckResponse,
  ReforgerConfigMod,
  UpdateModsResult,
  WorkshopModDetail,
  WorkshopModPreview,
} from '@reforger-panel/shared';
import { api } from '../api/client.js';
import {
  useConfiguration,
  useServerMods,
  useServerModsCheck,
  useServers,
  useSetPerformanceSettings,
  useSetServerMods,
  useWorkshopMod,
  useWorkshopSearch,
} from '../api/hooks.js';
import { formatRelativeTime } from '../lib/format.js';
import { Button, Card, EmptyState, ModImage, Spinner } from '../components/ui.js';

const COMMON_WORKSHOP_TAGS = [
  'SCENARIO',
  'SCENARIOS_MP',
  'SCENARIOS_SP',
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

const WORKSHOP_MOD_DETAIL_STALE_MS = 5 * 60_000;
const WORKSHOP_DETAIL_BATCH_INTERVAL_MS = 1_000;
const WORKSHOP_DETAIL_BATCH_SIZE = 4;
const WORKSHOP_DETAIL_BURST_CAPACITY = 20;
const WORKSHOP_DETAIL_FAILURE_COOLDOWN_MS = 60_000;
const WORKSHOP_DETAIL_PREFETCH_MARGIN = '500px';
const MODS_AUTOSAVE_DEBOUNCE_MS = 1_500;
const UPGRADE_ALL_DETAIL_BATCH_SIZE = 8;

const workshopDetailLimiter = {
  inFlight: false,
  burstTokens: WORKSHOP_DETAIL_BURST_CAPACITY,
  lastTokenRefillAt: Date.now(),
};

export function ModsPage({ user }: { user: CurrentUser }) {
  const { data: serversData } = useServers();
  const slug = serversData?.servers[0]?.slug;
  if (!slug) return <Spinner />;
  return <ModsBody slug={slug} user={user} />;
}

function sameMods(a: ReforgerConfigMod[], b: ReforgerConfigMod[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type ModsTab = 'installed' | 'browse';
type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const DEFAULT_SCENARIO_ID = '{FDE33AFE2ED7875B}Missions/23_Campaign_Montignac.conf';

function ModsBody({ slug, user }: { slug: string; user: CurrentUser }) {
  const canManage = user.capabilities.includes('mods.manage');
  const canEditConfig = user.capabilities.includes('config.edit');
  const { data, isLoading, error, refetch } = useServerMods(slug);
  const { data: configData } = useConfiguration(slug);
  const currentScenarioId = configData?.config.scenarioId ?? null;
  const { mutate: saveMutate, isPending: isSavingMods } = useSetServerMods(slug);
  const savePerf = useSetPerformanceSettings(slug);
  const [draft, setDraft] = useState<ReforgerConfigMod[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resetMissionMessage, setResetMissionMessage] = useState<string | null>(null);
  const [selectedModId, setSelectedModId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ModsTab>('installed');
  const [checkEnabled, setCheckEnabled] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [isUpgradingAll, setIsUpgradingAll] = useState(false);
  const checkQuery = useServerModsCheck(slug, checkEnabled);

  const serverMods = data?.mods ?? [];
  const mods = draft ?? serverMods;
  const modsKey = useMemo(() => JSON.stringify(mods), [mods]);
  const modsRef = useRef(mods);
  modsRef.current = mods;
  const dirty = draft !== null && !sameMods(draft, serverMods);
  const installedIds = new Set(mods.map((mod) => mod.modId.toUpperCase()));

  const missingVersionIds = new Set(mods.filter((m) => !m.version).map((m) => m.modId));

  const submitMods = useCallback(
    (
      submittedMods: ReforgerConfigMod[],
      getSuccessMessage: (result: UpdateModsResult, currentSaved: boolean) => string,
      source: 'manual' | 'auto' = 'manual',
    ) => {
      setMessage(null);
      setSaveStatus('saving');
      saveMutate(submittedMods, {
        onSuccess: (result) => {
          const currentSaved = sameMods(modsRef.current, submittedMods);
          if (currentSaved) setDraft(null);
          setSaveStatus(currentSaved ? 'saved' : 'pending');
          setMessage(getSuccessMessage(result, currentSaved));
          setCheckEnabled(false);
          void refetch();
        },
        onError: (saveError) => {
          setSaveStatus('error');
          setMessage(
            source === 'auto' ? `Autosave failed: ${saveError.message}` : saveError.message,
          );
        },
      });
    },
    [refetch, saveMutate],
  );

  useEffect(() => {
    if (!canManage || !dirty || isSavingMods || isLoading) return;
    setSaveStatus('pending');
    const timer = window.setTimeout(() => {
      submitMods(
        modsRef.current,
        (result, currentSaved) =>
          currentSaved
            ? `Autosaved — ${result.added} added, ${result.removed} removed. Restart to apply.`
            : 'Autosaved. More changes pending.',
        'auto',
      );
    }, MODS_AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [canManage, dirty, isLoading, isSavingMods, modsKey, submitMods]);

  const addMod = (mod: ReforgerConfigMod) => {
    if (installedIds.has(mod.modId.toUpperCase())) return;
    setMessage(null);
    setDraft([...mods, mod]);
  };

  const addMods = (newMods: ReforgerConfigMod[]) => {
    const toAdd = newMods.filter((m) => !installedIds.has(m.modId.toUpperCase()));
    if (toAdd.length === 0) return;
    setMessage(null);
    setDraft([...mods, ...toAdd]);
  };

  const removeMod = (modId: string) => {
    setMessage(null);
    if (selectedModId === modId) setSelectedModId(null);
    setDraft(mods.filter((mod) => mod.modId !== modId));
  };

  const updateModVersion = (modId: string, version: string) => {
    setMessage(null);
    const normalized = version.trim();
    setDraft(
      mods.map((mod) =>
        mod.modId === modId
          ? {
              ...mod,
              ...(normalized ? { version: normalized } : { version: undefined }),
            }
          : mod,
      ),
    );
  };

  const saveMods = () => {
    submitMods(mods, (result, currentSaved) =>
      currentSaved
        ? `Saved — ${result.added} added, ${result.removed} removed. Restart to apply.`
        : 'Saved. More changes pending.',
    );
  };

  const patchVersions = () => {
    submitMods(mods, (_result, currentSaved) =>
      currentSaved
        ? 'Version info patched. Restart to apply.'
        : 'Version info patched. More changes pending.',
    );
  };

  const upgradeAllVersions = async () => {
    if (!canManage || isUpgradingAll || isSavingMods || mods.length === 0) return;

    setIsUpgradingAll(true);
    setMessage(null);
    try {
      const details = await fetchWorkshopDetailsForMods(mods);
      let changed = 0;
      let foundVersions = 0;
      const upgraded = mods.map((mod) => {
        const detail = details.get(mod.modId.toUpperCase());
        if (!detail?.version) return mod;
        foundVersions += 1;
        if (mod.version === detail.version) return mod;
        changed += 1;
        return {
          ...mod,
          name: mod.name ?? detail.name,
          version: detail.version,
        };
      });

      if (changed === 0) {
        setMessage(
          foundVersions === 0
            ? 'No workshop version info was available for the installed mods.'
            : 'All installed mods are already on the latest known versions.',
        );
        return;
      }

      setDraft(upgraded);
      setSaveStatus('pending');
      setMessage(
        `Updated ${changed} version number${changed === 1 ? '' : 's'}. Autosave will write the changes shortly.`,
      );
    } finally {
      setIsUpgradingAll(false);
    }
  };

  const resetMission = () => {
    setResetMissionMessage(null);
    savePerf.mutate(
      { scenarioId: DEFAULT_SCENARIO_ID },
      {
        onSuccess: () =>
          setResetMissionMessage('Mission reset to Campaign - Montignac. Restart to apply.'),
        onError: (err) => setResetMissionMessage(err.message),
      },
    );
  };

  const runCheck = () => {
    if (dirty) {
      setMessage('Save your changes before checking dependencies.');
      return;
    }
    setCheckEnabled(true);
    if (checkQuery.isFetching) return;
    void checkQuery.refetch();
  };

  return (
    <div className="w-full space-y-4">
      <div>
        <h1 className="page-title">Mods</h1>
        <p className="page-kicker">
          Manage the server mod list and browse the Reforger Workshop. Changes apply on the next
          server restart.
        </p>
      </div>

      <div className="flex overflow-x-auto border-b border-graphite-700">
        {(['installed', 'browse'] as ModsTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`whitespace-nowrap px-4 py-2.5 text-sm font-semibold transition-colors ${
              activeTab === tab
                ? 'border-b-2 border-accent-500 text-accent-400'
                : 'text-slate-dim hover:text-zinc-200'
            }`}
          >
            {tab === 'installed'
              ? `Installed${mods.length > 0 ? ` (${mods.length})` : ''}`
              : 'Browse Workshop'}
          </button>
        ))}
      </div>

      {activeTab === 'installed' ? (
        <div>
          <InstalledModsPanel
            mods={mods}
            canManage={canManage}
            canEditConfig={canEditConfig}
            dirty={dirty}
            isSaving={isSavingMods}
            saveStatus={saveStatus}
            isUpgradingAll={isUpgradingAll}
            isResettingMission={savePerf.isPending}
            missingVersionIds={missingVersionIds}
            selectedModId={selectedModId}
            fetchedAt={data?.fetchedAt}
            isLoading={isLoading}
            loadError={error?.message ?? null}
            message={message}
            resetMissionMessage={resetMissionMessage}
            checkResult={checkEnabled ? (checkQuery.data ?? null) : null}
            isChecking={checkQuery.isFetching}
            installedIds={installedIds}
            currentScenarioId={currentScenarioId}
            onSelectMod={setSelectedModId}
            onRemoveMod={removeMod}
            onUpdateModVersion={updateModVersion}
            onSave={saveMods}
            onDiscard={() => {
              setDraft(null);
              setMessage(null);
              setSaveStatus('idle');
            }}
            onPatchVersions={patchVersions}
            onUpgradeAll={upgradeAllVersions}
            onCheckDeps={runCheck}
            onAddMods={addMods}
            onResetMission={resetMission}
          />
        </div>
      ) : (
        <WorkshopBrowser
          canManage={canManage}
          installedIds={installedIds}
          onAdd={addMod}
          selectedModId={selectedModId}
          setSelectedModId={setSelectedModId}
          onAddAllDeps={(deps) => void addAllDeps(deps, addMods)}
          currentScenarioId={currentScenarioId}
        />
      )}
    </div>
  );
}

async function addAllDeps(
  deps: Array<{ id: string | null; name: string }>,
  addMods: (mods: ReforgerConfigMod[]) => void,
) {
  const resolved = await Promise.allSettled(
    deps
      .filter((d) => d.id)
      .map(async (d): Promise<ReforgerConfigMod> => {
        try {
          const detail = await api.get<WorkshopModDetail>(`/api/workshop/mods/${d.id}`);
          return {
            modId: detail.id,
            name: detail.name,
            ...(detail.version ? { version: detail.version } : {}),
          };
        } catch {
          return { modId: d.id!, name: d.name };
        }
      }),
  );
  const mods = resolved
    .filter((r): r is PromiseFulfilledResult<ReforgerConfigMod> => r.status === 'fulfilled')
    .map((r) => r.value);
  addMods(mods);
}

async function fetchWorkshopDetailsForMods(
  mods: ReforgerConfigMod[],
): Promise<Map<string, WorkshopModDetail>> {
  const details = new Map<string, WorkshopModDetail>();

  for (let i = 0; i < mods.length; i += UPGRADE_ALL_DETAIL_BATCH_SIZE) {
    const batch = mods.slice(i, i + UPGRADE_ALL_DETAIL_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((mod) => api.get<WorkshopModDetail>(`/api/workshop/mods/${mod.modId}`)),
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        details.set(result.value.id.toUpperCase(), result.value);
      }
    }
  }

  return details;
}

function workshopModQueryKey(modId: string) {
  return ['workshop', 'mod', modId] as const;
}

function useQueuedWorkshopModDetails(modIds: string[], visibleModIds: Set<string>) {
  const queryClient = useQueryClient();
  const failedUntilRef = useRef(new Map<string, number>());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(() => new Set());
  const [cacheVersion, setCacheVersion] = useState(0);
  const modIdsKey = useMemo(() => modIds.join('|'), [modIds]);
  const visibleKey = useMemo(
    () => [...visibleModIds].sort((a, b) => a.localeCompare(b)).join('|'),
    [visibleModIds],
  );

  useEffect(() => {
    if (workshopDetailLimiter.inFlight) return;
    const now = Date.now();
    const elapsedMs = now - workshopDetailLimiter.lastTokenRefillAt;
    if (elapsedMs > 0) {
      workshopDetailLimiter.burstTokens = Math.min(
        WORKSHOP_DETAIL_BURST_CAPACITY,
        workshopDetailLimiter.burstTokens + elapsedMs / 1000,
      );
      workshopDetailLimiter.lastTokenRefillAt = now;
    }

    const tokenCount = Math.floor(workshopDetailLimiter.burstTokens);
    const batch = modIds
      .filter((modId) => {
        if (!visibleModIds.has(modId)) return false;
        if ((failedUntilRef.current.get(modId) ?? 0) > now) return false;
        return !queryClient.getQueryData<WorkshopModDetail>(workshopModQueryKey(modId));
      })
      .slice(0, Math.min(WORKSHOP_DETAIL_BATCH_SIZE, tokenCount));

    if (batch.length === 0) {
      const timer = window.setTimeout(
        () => setCacheVersion((version) => version + 1),
        WORKSHOP_DETAIL_BATCH_INTERVAL_MS,
      );
      return () => window.clearTimeout(timer);
    }

    const timer = window.setTimeout(() => {
      workshopDetailLimiter.burstTokens = Math.max(
        0,
        workshopDetailLimiter.burstTokens - batch.length,
      );
      workshopDetailLimiter.inFlight = true;
      setLoadingIds(new Set(batch.map((modId) => modId.toUpperCase())));
      Promise.allSettled(
        batch.map((modId) =>
          queryClient.fetchQuery({
            queryKey: workshopModQueryKey(modId),
            queryFn: () => api.get<WorkshopModDetail>(`/api/workshop/mods/${modId}`),
            staleTime: WORKSHOP_MOD_DETAIL_STALE_MS,
            retry: false,
          }),
        ),
      )
        .then((results) => {
          for (let i = 0; i < results.length; i++) {
            if (results[i]?.status === 'rejected') {
              failedUntilRef.current.set(
                batch[i]!,
                Date.now() + WORKSHOP_DETAIL_FAILURE_COOLDOWN_MS,
              );
            }
          }
        })
        .finally(() => {
          workshopDetailLimiter.inFlight = false;
          setLoadingIds(new Set());
          setCacheVersion((version) => version + 1);
        });
    }, WORKSHOP_DETAIL_BATCH_INTERVAL_MS);

    return () => window.clearTimeout(timer);
  }, [cacheVersion, modIds, modIdsKey, queryClient, visibleKey, visibleModIds]);

  const detailByModId = useMemo(() => {
    const details = new Map<string, WorkshopModDetail>();
    for (const modId of modIds) {
      const detail = queryClient.getQueryData<WorkshopModDetail>(workshopModQueryKey(modId));
      if (detail) details.set(modId.toUpperCase(), detail);
    }
    return details;
  }, [cacheVersion, modIds, queryClient]);

  return { detailByModId, loadingDetailIds: loadingIds };
}

// ── Installed Mods Panel ──────────────────────────────────────────────────────

function InstalledModsPanel({
  mods,
  canManage,
  canEditConfig,
  dirty,
  isSaving,
  saveStatus,
  isUpgradingAll,
  isResettingMission,
  missingVersionIds,
  selectedModId,
  fetchedAt,
  isLoading,
  loadError,
  message,
  resetMissionMessage,
  checkResult,
  isChecking,
  installedIds,
  currentScenarioId,
  onSelectMod,
  onRemoveMod,
  onUpdateModVersion,
  onSave,
  onDiscard,
  onPatchVersions,
  onUpgradeAll,
  onCheckDeps,
  onAddMods,
  onResetMission,
}: {
  mods: ReforgerConfigMod[];
  canManage: boolean;
  canEditConfig: boolean;
  dirty: boolean;
  isSaving: boolean;
  saveStatus: SaveStatus;
  isUpgradingAll: boolean;
  isResettingMission: boolean;
  missingVersionIds: Set<string>;
  selectedModId: string | null;
  fetchedAt?: string;
  isLoading: boolean;
  loadError: string | null;
  message: string | null;
  resetMissionMessage: string | null;
  checkResult: ModsCheckResponse | null;
  isChecking: boolean;
  installedIds: Set<string>;
  currentScenarioId: string | null;
  onSelectMod: (id: string | null) => void;
  onRemoveMod: (id: string) => void;
  onUpdateModVersion: (id: string, version: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onPatchVersions: () => void;
  onUpgradeAll: () => void;
  onCheckDeps: () => void;
  onAddMods: (mods: ReforgerConfigMod[]) => void;
  onResetMission: () => void;
}) {
  const missingDepsByModId = new Map<string, ModDependencyIssue>();
  if (checkResult) {
    for (const issue of checkResult.modsWithMissingDeps) {
      missingDepsByModId.set(issue.modId.toUpperCase(), issue);
    }
  }

  const allMissingDeps = checkResult
    ? checkResult.modsWithMissingDeps.flatMap((issue) => issue.missing)
    : [];
  const uniqueMissingDeps = [
    ...new Map(allMissingDeps.filter((d) => d.id).map((d) => [d.id, d])).values(),
  ];
  const [visibleModIds, setVisibleModIds] = useState<Set<string>>(() => new Set());
  const installedModIds = useMemo(() => mods.map((mod) => mod.modId), [mods]);
  const { detailByModId, loadingDetailIds } = useQueuedWorkshopModDetails(
    installedModIds,
    visibleModIds,
  );
  const handleInstalledModVisibility = useCallback((modId: string, visible: boolean) => {
    setVisibleModIds((current) => {
      const next = new Set(current);
      if (visible) {
        next.add(modId);
      } else {
        next.delete(modId);
      }
      return next;
    });
  }, []);
  const selectedInstalledModId = mods.some((mod) => mod.modId === selectedModId)
    ? selectedModId
    : null;

  return (
    <Card
      title={`Installed Mods${mods.length > 0 ? ` (${mods.length})` : ''}`}
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canManage && mods.length > 0 && (
            <Button
              variant="accent"
              onClick={onUpgradeAll}
              disabled={isSaving || isUpgradingAll}
              title="Fetch the latest Workshop version for every installed mod"
            >
              {isUpgradingAll ? 'Upgrading…' : 'Upgrade all'}
            </Button>
          )}
          {saveStatus === 'pending' && (
            <span className="text-xs text-warn-400">autosave pending</span>
          )}
          {saveStatus === 'saving' && <span className="text-xs text-slate-dim">saving…</span>}
          {saveStatus === 'saved' && !dirty && (
            <span className="text-xs text-accent-400">autosaved</span>
          )}
          {saveStatus === 'error' && (
            <span className="text-xs text-danger-400">autosave failed</span>
          )}
          {!dirty && saveStatus !== 'saved' && fetchedAt && (
            <span className="text-xs text-slate-dim">fetched {formatRelativeTime(fetchedAt)}</span>
          )}
          {dirty && (
            <>
              <Button onClick={onDiscard} disabled={isSaving}>
                Discard
              </Button>
              <Button variant="accent" onClick={onSave} disabled={isSaving}>
                {isSaving ? 'Saving…' : 'Save now'}
              </Button>
            </>
          )}
        </div>
      }
    >
      {isLoading ? (
        <Spinner label="Downloading config.json…" />
      ) : loadError ? (
        <p className="text-sm text-danger-400">{loadError}</p>
      ) : mods.length === 0 ? (
        <EmptyState
          title="No mods installed"
          hint={canManage ? 'Add mods from the Workshop.' : 'The server runs vanilla.'}
        />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {mods.map((mod) => {
              const modIdKey = mod.modId.toUpperCase();
              return (
                <InstalledModCard
                  key={mod.modId}
                  mod={mod}
                  detail={detailByModId.get(modIdKey) ?? null}
                  isLoadingDetail={loadingDetailIds.has(modIdKey)}
                  depIssue={missingDepsByModId.get(modIdKey) ?? null}
                  noVersion={missingVersionIds.has(mod.modId)}
                  selected={selectedModId === mod.modId}
                  canManage={canManage}
                  onView={() => onSelectMod(selectedModId === mod.modId ? null : mod.modId)}
                  onRemove={() => onRemoveMod(mod.modId)}
                  onUpdateVersion={(version) => onUpdateModVersion(mod.modId, version)}
                  onVisibilityChange={handleInstalledModVisibility}
                />
              );
            })}
          </div>
        </div>
      )}

      {selectedInstalledModId && (
        <ModDetailModal
          modId={selectedInstalledModId}
          canManage={canManage}
          installedIds={installedIds}
          currentScenarioId={currentScenarioId}
          onClose={() => onSelectMod(null)}
          onAdd={(mod) => onAddMods([mod])}
          onAddAllDeps={(deps) => void addAllDeps(deps, onAddMods)}
        />
      )}

      {/* Bulk action toolbar */}
      {mods.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-graphite-800 pt-3">
          {canManage && missingVersionIds.size > 0 && (
            <Button onClick={onPatchVersions} disabled={isSaving} variant="accent">
              {isSaving
                ? 'Patching…'
                : `Patch ${missingVersionIds.size} missing version${missingVersionIds.size !== 1 ? 's' : ''}`}
            </Button>
          )}
          <Button onClick={onCheckDeps} disabled={isChecking || dirty}>
            {isChecking ? 'Checking…' : 'Check Dependencies'}
          </Button>
          {checkResult && !isChecking && (
            <span className="text-xs text-slate-dim">
              checked {formatRelativeTime(checkResult.checkedAt)}
            </span>
          )}
        </div>
      )}

      {/* Orphaned mission alert from dependency check */}
      {checkResult && !isChecking && checkResult.orphanedMission && (
        <div className="mt-3 rounded-md border border-danger-400/40 bg-danger-400/5 p-3">
          <p className="mb-1 text-sm font-semibold text-danger-400">Mission will be unavailable</p>
          <p className="mb-2 text-xs text-zinc-400">
            The configured mission{' '}
            <span className="font-mono text-zinc-300">
              {checkResult.orphanedMission.name ??
                checkResult.orphanedMission.scenarioId.split('/').pop()}
            </span>{' '}
            is not provided by any installed mod or official content. The server will fail to start.
          </p>
          {canEditConfig ? (
            <Button variant="danger" onClick={onResetMission} disabled={isResettingMission}>
              {isResettingMission ? 'Saving…' : 'Reset to Campaign - Montignac (default)'}
            </Button>
          ) : (
            <p className="text-xs text-zinc-400">Switch the mission on the Configuration page.</p>
          )}
          {resetMissionMessage && (
            <p className="mt-2 text-xs text-accent-400">{resetMissionMessage}</p>
          )}
        </div>
      )}

      {/* Dependency check results summary */}
      {checkResult && !isChecking && uniqueMissingDeps.length > 0 && (
        <div className="mt-3 rounded-md border border-danger-400/30 bg-danger-400/5 p-3">
          <p className="mb-2 text-sm font-semibold text-danger-400">
            {checkResult.modsWithMissingDeps.length} mod
            {checkResult.modsWithMissingDeps.length !== 1 ? 's' : ''} have missing dependencies (
            {uniqueMissingDeps.length} unique)
          </p>
          {canManage && (
            <Button variant="accent" onClick={() => void addAllDeps(uniqueMissingDeps, onAddMods)}>
              Add all {uniqueMissingDeps.length} missing
            </Button>
          )}
        </div>
      )}
      {checkResult &&
        !isChecking &&
        checkResult.modsWithMissingDeps.length === 0 &&
        !checkResult.orphanedMission && (
          <p className="mt-3 text-xs text-accent-400">All dependencies are installed.</p>
        )}

      {message && <p className="mt-3 text-xs text-accent-400">{message}</p>}
      <p className="mt-3 text-xs text-slate-dim">
        Changes are written to config.json (backup kept) and take effect on restart.
      </p>
    </Card>
  );
}

function InstalledModCard({
  mod,
  detail,
  isLoadingDetail,
  depIssue,
  noVersion,
  selected,
  canManage,
  onView,
  onRemove,
  onUpdateVersion,
  onVisibilityChange,
}: {
  mod: ReforgerConfigMod;
  detail: WorkshopModDetail | null;
  isLoadingDetail: boolean;
  depIssue: ModDependencyIssue | null;
  noVersion: boolean;
  selected: boolean;
  canManage: boolean;
  onView: () => void;
  onRemove: () => void;
  onUpdateVersion: (version: string) => void;
  onVisibilityChange: (modId: string, visible: boolean) => void;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const title = detail?.name ?? mod.name ?? mod.modId;
  const configuredVersion = mod.version ?? '';
  const latestVersion = detail?.version ?? null;
  const updateAvailable =
    latestVersion !== null && configuredVersion !== '' && latestVersion !== configuredVersion;
  const description = detail?.summary ?? detail?.description ?? null;
  const tags = detail?.tags ?? [];

  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    if (!('IntersectionObserver' in window)) {
      onVisibilityChange(mod.modId, true);
      return () => onVisibilityChange(mod.modId, false);
    }

    const observer = new IntersectionObserver(
      ([entry]) => onVisibilityChange(mod.modId, entry?.isIntersecting ?? false),
      { rootMargin: WORKSHOP_DETAIL_PREFETCH_MARGIN },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      onVisibilityChange(mod.modId, false);
    };
  }, [mod.modId, onVisibilityChange]);

  return (
    <article
      ref={cardRef}
      className={`flex min-h-[390px] flex-col overflow-hidden rounded-md border bg-graphite-900 shadow-sm shadow-black/20 transition-colors ${
        selected ? 'border-accent-600/70' : 'border-graphite-700/70 hover:border-graphite-600'
      }`}
    >
      <button type="button" onClick={onView} className="relative aspect-[16/9] text-left">
        <ModImage src={detail?.imageUrl ?? null} className="h-full w-full rounded-none border-0" />
        <span className="absolute right-2 top-2 rounded border border-emerald-400/40 bg-emerald-500/20 px-2 py-1 text-[10px] font-semibold uppercase text-emerald-300">
          Installed
        </span>
        {isLoadingDetail && (
          <span className="absolute bottom-2 left-2 rounded border border-graphite-600 bg-graphite-950/80 px-2 py-1 text-[10px] font-semibold uppercase text-slate-ink">
            Loading
          </span>
        )}
      </button>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-6 text-zinc-100">{title}</h3>
          <p className="mt-0.5 truncate font-mono text-xs text-slate-dim">{mod.modId}</p>
          <p className="mt-1 text-xs text-slate-dim">
            configured v{configuredVersion || '-'}
            {latestVersion && latestVersion !== configuredVersion
              ? ` · latest v${latestVersion}`
              : ''}
          </p>
        </div>
        <p className="min-h-16 overflow-hidden text-sm leading-5 text-slate-ink">
          {description ?? 'No description available.'}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {noVersion && (
            <span
              title="No version info - click Patch Versions"
              className="rounded border border-warn-400/40 bg-warn-400/10 px-2 py-0.5 text-[11px] font-semibold text-warn-400"
            >
              no version
            </span>
          )}
          {depIssue && (
            <span
              title={`Missing deps: ${depIssue.missing.map((d) => d.name).join(', ')}`}
              className="rounded border border-danger-400/40 bg-danger-400/10 px-2 py-0.5 text-[11px] font-semibold text-danger-400"
            >
              {depIssue.missing.length} dep{depIssue.missing.length !== 1 ? 's' : ''} missing
            </span>
          )}
          {tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-graphite-700 bg-graphite-950/35 px-2 py-0.5 text-[11px] font-medium text-slate-ink"
            >
              {tag}
            </span>
          ))}
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          {canManage && (
            <div className="grid w-full gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-dim">
                Version
              </label>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  value={configuredVersion}
                  onChange={(event) => onUpdateVersion(event.target.value)}
                  placeholder={latestVersion ?? 'manual version'}
                  maxLength={32}
                  className="input min-h-9 px-2.5 py-1.5 font-mono text-xs"
                />
                <Button
                  variant={updateAvailable ? 'accent' : 'default'}
                  disabled={!latestVersion || configuredVersion === latestVersion}
                  onClick={() => latestVersion && onUpdateVersion(latestVersion)}
                  title={
                    latestVersion
                      ? `Use latest version ${latestVersion}`
                      : 'Latest version not loaded'
                  }
                >
                  Use latest
                </Button>
              </div>
            </div>
          )}
          <Button onClick={onView}>{selected ? 'Hide details' : 'View'}</Button>
          {canManage && (
            <Button variant="danger" onClick={onRemove}>
              Remove
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

// ── Workshop Browser ──────────────────────────────────────────────────────────

function WorkshopBrowser({
  canManage,
  installedIds,
  onAdd,
  selectedModId,
  setSelectedModId,
  onAddAllDeps,
  currentScenarioId,
}: {
  canManage: boolean;
  installedIds: Set<string>;
  onAdd: (mod: ReforgerConfigMod) => void;
  selectedModId: string | null;
  setSelectedModId: (id: string | null) => void;
  onAddAllDeps: (deps: Array<{ id: string | null; name: string }>) => void;
  currentScenarioId: string | null;
}) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [sort, setSort] = useState<(typeof WORKSHOP_SORTS)[number]['value']>('popularity');
  const [page, setPage] = useState(1);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [visibleModIds, setVisibleModIds] = useState<Set<string>>(() => new Set());
  const effectiveQuery = [query, activeTag].filter(Boolean).join(' ');
  const { data, isFetching, error } = useWorkshopSearch(effectiveQuery, page, sort);
  const browseModIds = useMemo(() => data?.mods.map((mod) => mod.id) ?? [], [data?.mods]);
  const { detailByModId, loadingDetailIds } = useQueuedWorkshopModDetails(
    browseModIds,
    visibleModIds,
  );
  const handleBrowseModVisibility = useCallback((modId: string, visible: boolean) => {
    setVisibleModIds((current) => {
      const next = new Set(current);
      if (visible) {
        next.add(modId);
      } else {
        next.delete(modId);
      }
      return next;
    });
  }, []);

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
    <section className="space-y-4">
      <div className="rounded-md border border-graphite-700/70 bg-graphite-900 p-4 shadow-sm shadow-black/20">
        <form
          className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_auto]"
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
            placeholder="Search mods… (empty = front page)"
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
              Clear
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-danger-400">{error.message}</p>}
      {!data && !error && <Spinner label="Loading Workshop mods…" />}

      {data && (
        <>
          <div className={`min-w-0 ${isFetching ? 'opacity-60' : ''} transition-opacity`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-dim">
                {effectiveQuery
                  ? `${data.meta.totalMods.toLocaleString()} results for "${effectiveQuery}"`
                  : `${data.meta.totalMods.toLocaleString()} Workshop mods`}{' '}
                · page {data.meta.currentPage} of {data.meta.totalPages}
              </p>
              <div className="flex items-center gap-2">
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
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {data.mods.map((mod) => {
                const installed = installedIds.has(mod.id.toUpperCase());
                return (
                  <WorkshopModCard
                    key={mod.id}
                    mod={mod}
                    detail={detailByModId.get(mod.id.toUpperCase()) ?? null}
                    installed={installed}
                    selected={selectedModId === mod.id}
                    canManage={canManage}
                    isLoadingDetail={loadingDetailIds.has(mod.id.toUpperCase())}
                    isAdding={addingId === mod.id}
                    onSelect={() => setSelectedModId(selectedModId === mod.id ? null : mod.id)}
                    onAdd={() => void addFromWorkshop(mod.id, mod.name)}
                    onTagSelect={(tag) => {
                      setActiveTag(tag);
                      setPage(1);
                      setSelectedModId(null);
                    }}
                    onVisibilityChange={handleBrowseModVisibility}
                  />
                );
              })}
            </div>
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
          {selectedModId && (
            <ModDetailModal
              modId={selectedModId}
              canManage={canManage}
              installedIds={installedIds}
              currentScenarioId={currentScenarioId}
              onClose={() => setSelectedModId(null)}
              onAdd={onAdd}
              onAddAllDeps={onAddAllDeps}
              onTagSelect={(tag) => {
                setActiveTag(tag);
                setPage(1);
                setSelectedModId(null);
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

function WorkshopModCard({
  mod,
  detail,
  installed,
  selected,
  canManage,
  isLoadingDetail,
  isAdding,
  onSelect,
  onAdd,
  onTagSelect,
  onVisibilityChange,
}: {
  mod: WorkshopModPreview;
  detail: WorkshopModDetail | null;
  installed: boolean;
  selected: boolean;
  canManage: boolean;
  isLoadingDetail: boolean;
  isAdding: boolean;
  onSelect: () => void;
  onAdd: () => void;
  onTagSelect: (tag: string) => void;
  onVisibilityChange: (modId: string, visible: boolean) => void;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const title = detail?.name ?? mod.name;
  const author = detail?.author ?? mod.author;
  const version = detail?.version ?? mod.version;
  const size = detail?.size ?? mod.size;
  const description = detail?.summary ?? detail?.description ?? mod.summary;
  const tags = detail?.tags.length ? detail.tags : mod.tags;
  const imageUrl = detail?.imageUrl ?? mod.imageUrl;

  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    if (!('IntersectionObserver' in window)) {
      onVisibilityChange(mod.id, true);
      return () => onVisibilityChange(mod.id, false);
    }

    const observer = new IntersectionObserver(
      ([entry]) => onVisibilityChange(mod.id, entry?.isIntersecting ?? false),
      { rootMargin: WORKSHOP_DETAIL_PREFETCH_MARGIN },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      onVisibilityChange(mod.id, false);
    };
  }, [mod.id, onVisibilityChange]);

  return (
    <article
      ref={cardRef}
      className={`flex min-h-[390px] flex-col overflow-hidden rounded-md border bg-graphite-900 shadow-sm shadow-black/20 transition-colors ${
        selected ? 'border-accent-600/70' : 'border-graphite-700/70 hover:border-graphite-600'
      }`}
    >
      <button type="button" onClick={onSelect} className="relative aspect-[16/9] text-left">
        <ModImage src={imageUrl} className="h-full w-full rounded-none border-0" />
        {installed && (
          <span className="absolute right-2 top-2 rounded border border-emerald-400/40 bg-emerald-500/20 px-2 py-1 text-[10px] font-semibold uppercase text-emerald-300">
            Installed
          </span>
        )}
        {isLoadingDetail && (
          <span className="absolute bottom-2 left-2 rounded border border-graphite-600 bg-graphite-950/80 px-2 py-1 text-[10px] font-semibold uppercase text-slate-ink">
            Loading
          </span>
        )}
      </button>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-6 text-zinc-100">{title}</h3>
          <p className="mt-0.5 text-xs text-slate-dim">
            by {author} · v{version ?? '-'} · {size ?? '-'}
          </p>
        </div>
        <p className="min-h-16 overflow-hidden text-sm leading-5 text-slate-ink">
          {description ?? 'No description available.'}
        </p>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, 4).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onTagSelect(tag)}
                className="rounded-full border border-graphite-700 bg-graphite-950/35 px-2 py-0.5 text-[11px] font-medium text-slate-ink hover:border-accent-500/50 hover:text-accent-400"
              >
                {tag}
              </button>
            ))}
          </div>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          <Button onClick={onSelect}>{selected ? 'Hide details' : 'Details'}</Button>
          {canManage && !installed && (
            <Button variant="accent" disabled={isAdding} onClick={onAdd}>
              {isAdding ? 'Adding...' : 'Add'}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

// ── Mod Detail Modal ──────────────────────────────────────────────────────────

function ModDetailModal({
  modId,
  canManage,
  installedIds,
  currentScenarioId,
  onClose,
  onAdd,
  onAddAllDeps,
  onTagSelect,
}: {
  modId: string | null;
  canManage: boolean;
  installedIds: Set<string>;
  currentScenarioId: string | null;
  onClose: () => void;
  onAdd: (mod: ReforgerConfigMod) => void;
  onAddAllDeps: (deps: Array<{ id: string | null; name: string }>) => void;
  onTagSelect?: (tag: string) => void;
}) {
  const { data: mod, isLoading, error } = useWorkshopMod(modId);
  const [addingDepId, setAddingDepId] = useState<string | null>(null);
  const [addingAllDeps, setAddingAllDeps] = useState(false);
  const [copiedScenarioId, setCopiedScenarioId] = useState<string | null>(null);
  const [copyFailedScenarioId, setCopyFailedScenarioId] = useState<string | null>(null);

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

  const copyScenarioId = async (scenarioId: string, input: HTMLInputElement | null) => {
    const value = scenarioId.trim();
    if (!value) return;

    const markCopied = () => {
      setCopyFailedScenarioId(null);
      setCopiedScenarioId(value);
      window.setTimeout(() => setCopiedScenarioId(null), 1500);
    };

    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(value);
        markCopied();
        return;
      } catch {
        // Fall back to selecting the readonly input for browsers that block Clipboard API in modals.
      }
    }

    let copied = false;
    if (input) {
      input.focus();
      input.select();
      input.setSelectionRange(0, value.length);
      copied = document.execCommand('copy');
    }

    if (copied) {
      markCopied();
      return;
    }

    setCopiedScenarioId(null);
    setCopyFailedScenarioId(value);
    window.setTimeout(() => setCopyFailedScenarioId(null), 1800);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (!modId) return null;

  const installed = mod ? installedIds.has(mod.id.toUpperCase()) : false;
  const missingDeps = (mod?.dependencies ?? []).filter(
    (dep) => dep.id && !installedIds.has(dep.id.toUpperCase()),
  );

  const providesCurrentMission =
    mod !== undefined &&
    currentScenarioId !== null &&
    mod.scenarios.some((s) => s.scenarioId === currentScenarioId);
  const missionWillBeOrphaned = providesCurrentMission && !installed;
  const matchingScenario = mod?.scenarios.find((s) => s.scenarioId === currentScenarioId);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close mod details"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <section className="relative flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-lg border border-graphite-700 bg-graphite-900 shadow-2xl shadow-black/50 sm:rounded-lg">
        <div className="flex items-center justify-between gap-3 border-b border-graphite-700 px-4 py-3">
          <h2 className="truncate text-sm font-semibold uppercase tracking-[0.14em] text-slate-ink">
            Mod Details
          </h2>
          <Button onClick={onClose}>Close</Button>
        </div>

        <div className="overflow-y-auto">
          {error ? (
            <div className="p-6">
              <p className="text-sm font-semibold text-danger-400">Could not load mod details</p>
              <p className="mt-1 text-sm text-slate-ink">{error.message}</p>
            </div>
          ) : isLoading || !mod ? (
            <Spinner label="Loading mod details..." />
          ) : (
            <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:p-5">
              <div className="space-y-3">
                <ModImage src={mod.imageUrl} className="aspect-[16/9] h-auto w-full" />
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <DetailMetric label="Version" value={mod.version ?? '-'} />
                  <DetailMetric label="Rating" value={mod.rating ?? '-'} />
                  <DetailMetric label="Downloads" value={mod.downloads?.toLocaleString() ?? '-'} />
                  <DetailMetric label="Size" value={mod.size ?? '-'} />
                  <DetailMetric label="Game" value={mod.gameVersion ?? '-'} />
                  <DetailMetric
                    label="Subscribers"
                    value={mod.subscribers?.toLocaleString() ?? '-'}
                  />
                </div>
              </div>

              <div className="min-w-0 space-y-4">
                {missionWillBeOrphaned && (
                  <div className="rounded-md border border-danger-400/40 bg-danger-400/8 px-3 py-2.5">
                    <p className="text-sm font-semibold text-danger-400">
                      Active mission is from this mod
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      The server is configured to run{' '}
                      <span className="font-mono text-zinc-300">
                        {matchingScenario?.name ?? currentScenarioId?.split('/').pop()}
                      </span>
                      . Without this mod installed the server will fail to start.
                    </p>
                  </div>
                )}

                <div>
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-2xl font-semibold leading-tight text-zinc-100">
                        {mod.name}
                      </h3>
                      <p className="mt-1 text-sm text-slate-ink">by {mod.author}</p>
                      <p className="mt-1 break-all font-mono text-xs text-slate-dim">{mod.id}</p>
                    </div>
                    {installed && (
                      <span className="shrink-0 rounded border border-emerald-400/40 bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold uppercase text-emerald-300">
                        Installed
                      </span>
                    )}
                  </div>
                  <p className="text-sm leading-6 text-zinc-300">
                    {mod.description ?? mod.summary ?? 'No description available.'}
                  </p>
                </div>

                {mod.tags.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Tags
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {mod.tags.map((tag) =>
                        onTagSelect ? (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => onTagSelect(tag)}
                            className="rounded-full border border-graphite-700 bg-graphite-950/35 px-2 py-0.5 text-xs text-slate-ink hover:border-accent-500/50 hover:text-accent-400"
                          >
                            {tag}
                          </button>
                        ) : (
                          <span
                            key={tag}
                            className="rounded-full border border-graphite-700 bg-graphite-950/35 px-2 py-0.5 text-xs text-slate-ink"
                          >
                            {tag}
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                )}

                {mod.scenarios.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Scenarios ({mod.scenarios.length})
                    </p>
                    <div className="space-y-2">
                      {mod.scenarios.map((scenario, index) => {
                        return (
                          <ScenarioDetailRow
                            key={`${scenario.name}-${scenario.scenarioId}-${index}`}
                            scenario={scenario}
                            copied={copiedScenarioId === scenario.scenarioId}
                            copyFailed={copyFailedScenarioId === scenario.scenarioId}
                            onCopy={copyScenarioId}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {mod.dependencies.length > 0 && (
                  <div>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                        Dependencies ({mod.dependencies.length})
                      </p>
                      {canManage && missingDeps.length > 0 && (
                        <Button
                          variant="accent"
                          disabled={addingAllDeps}
                          onClick={() => {
                            setAddingAllDeps(true);
                            onAddAllDeps(missingDeps);
                            setTimeout(() => setAddingAllDeps(false), 1000);
                          }}
                        >
                          {addingAllDeps ? 'Adding...' : `Add all missing (${missingDeps.length})`}
                        </Button>
                      )}
                    </div>
                    <ul className="space-y-1">
                      {mod.dependencies.map((dep) => {
                        const depInstalled = dep.id
                          ? installedIds.has(dep.id.toUpperCase())
                          : false;
                        return (
                          <li
                            key={dep.id ?? dep.name}
                            className="flex items-center justify-between gap-2 rounded border border-graphite-800 bg-graphite-950/25 px-2.5 py-1.5"
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-sm text-zinc-300">{dep.name}</span>
                              {depInstalled ? (
                                <span className="shrink-0 text-xs text-accent-400">Installed</span>
                              ) : (
                                <span className="shrink-0 text-xs text-warn-400">Missing</span>
                              )}
                            </span>
                            {canManage && dep.id && !depInstalled && (
                              <Button
                                variant="accent"
                                disabled={addingDepId === dep.id}
                                onClick={() => dep.id && void addDep(dep.id, dep.name)}
                              >
                                {addingDepId === dep.id ? 'Adding...' : 'Add'}
                              </Button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 border-t border-graphite-800 pt-4">
                  {canManage && !installed && (
                    <Button
                      variant="accent"
                      onClick={() =>
                        onAdd({
                          modId: mod.id,
                          name: mod.name,
                          ...(mod.version ? { version: mod.version } : {}),
                        })
                      }
                    >
                      Add to server
                    </Button>
                  )}
                  {mod.workshopUrl && (
                    <a
                      href={mod.workshopUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-accent-400 hover:underline"
                    >
                      Open in Workshop
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ScenarioDetailRow({
  scenario,
  copied,
  copyFailed,
  onCopy,
}: {
  scenario: WorkshopModDetail['scenarios'][number];
  copied: boolean;
  copyFailed: boolean;
  onCopy: (scenarioId: string, input: HTMLInputElement | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="rounded border border-graphite-800 bg-graphite-950/25 p-3">
      <div className="space-y-2">
        <p className="text-sm font-medium text-zinc-200">{scenario.name}</p>
        <div className="grid gap-2">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-dim">
            Scenario ID
          </label>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              ref={inputRef}
              readOnly
              value={scenario.scenarioId}
              placeholder="No scenario ID found"
              className="input min-h-9 w-full font-mono text-xs"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              disabled={!scenario.scenarioId}
              onClick={() => onCopy(scenario.scenarioId, inputRef.current)}
              title="Copy scenario ID"
            >
              {copyFailed ? 'Copy failed' : copied ? 'Copied' : 'Copy ID'}
            </Button>
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-ink">
        {scenario.gamemode ?? 'Scenario'} · players {scenario.playerCount ?? '-'}
      </p>
      {scenario.description && (
        <p className="mt-2 text-xs leading-5 text-slate-ink">{scenario.description}</p>
      )}
    </div>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-graphite-800 bg-graphite-950/25 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-dim">{label}</p>
      <p className="mt-1 truncate text-sm text-zinc-200" title={value}>
        {value}
      </p>
    </div>
  );
}
