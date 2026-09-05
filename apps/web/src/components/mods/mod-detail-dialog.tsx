import { useWorkshopMod } from '../../api/hooks.js';
import { formatBytes, formatDateTime } from '../../lib/format.js';
import { Badge, Button, Dialog, EmptyState, ModImage, Spinner } from '../ui.js';

/** Read-only Workshop record for one mod, with the add/remove action inline. */
export function ModDetailDialog({
  modId,
  onClose,
  installed,
  canManage,
  onAdd,
  onRemove,
}: {
  modId: string | null;
  onClose: () => void;
  installed: boolean;
  canManage: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const { data: mod, isLoading, error } = useWorkshopMod(modId);

  return (
    <Dialog
      open={modId !== null}
      onClose={onClose}
      width="lg"
      title={mod?.name ?? 'Mod details'}
      description={mod ? `by ${mod.author}` : undefined}
      footer={
        canManage &&
        mod && (
          <>
            {mod.workshopUrl && (
              <a
                href={mod.workshopUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mr-auto inline-flex items-center gap-1.5 text-xs text-accent-400 hover:underline"
              >
                Open on the Workshop
              </a>
            )}
            {installed ? (
              <Button variant="danger" icon="minus" onClick={onRemove}>
                Remove from server
              </Button>
            ) : (
              <Button variant="accent" icon="plus" onClick={onAdd}>
                Add to server
              </Button>
            )}
          </>
        )
      }
    >
      {isLoading ? (
        <Spinner label="Loading mod details…" />
      ) : error || !mod ? (
        <EmptyState
          icon="alert"
          title="This mod could not be loaded"
          hint="It may be private, delisted, or the metadata service may be down."
        />
      ) : (
        <div className="space-y-4">
          <div className="flex gap-4">
            <ModImage src={mod.imageUrl} className="h-24 w-40" />
            <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <Detail label="Latest version" value={mod.version ?? '—'} />
              <Detail label="Game version" value={mod.gameVersion ?? '—'} />
              <Detail
                label="Size"
                value={mod.sizeBytes ? formatBytes(mod.sizeBytes) : (mod.sizeText ?? '—')}
              />
              <Detail
                label="With dependencies"
                value={mod.totalSizeBytes ? formatBytes(mod.totalSizeBytes) : '—'}
              />
              <Detail
                label="Rating"
                value={
                  mod.rating === null
                    ? '—'
                    : `${Math.round(mod.rating * 100)}%${mod.ratingCount ? ` (${mod.ratingCount})` : ''}`
                }
              />
              <Detail label="Subscribers" value={mod.subscriberCount?.toLocaleString() ?? '—'} />
              <Detail label="Updated" value={formatDateTime(mod.updatedAt)} />
              <Detail label="Mod ID" value={mod.id} mono />
            </dl>
          </div>

          {(mod.obsolete || mod.tags.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {mod.obsolete && <Badge tone="danger">obsolete</Badge>}
              {mod.tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
          )}

          {(mod.summary ?? mod.description) && (
            <div>
              <p className="eyebrow mb-1.5">Description</p>
              <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-ink">
                {mod.description ?? mod.summary}
              </p>
            </div>
          )}

          {mod.dependencies.length > 0 && (
            <div>
              <p className="eyebrow mb-1.5">Requires {mod.dependencies.length} other mods</p>
              <ul className="divide-y divide-graphite-800 rounded-sm border border-graphite-700">
                {mod.dependencies.map((dependency) => (
                  <li key={dependency.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                    <span className="min-w-0 flex-1 truncate text-zinc-200">{dependency.name}</span>
                    <span className="numeric shrink-0 text-slate-dim">
                      {dependency.sizeBytes ? formatBytes(dependency.sizeBytes) : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {mod.scenarios.length > 0 && (
            <div>
              <p className="eyebrow mb-1.5">
                Ships {mod.scenarios.length} scenario{mod.scenarios.length === 1 ? '' : 's'}
              </p>
              <ul className="divide-y divide-graphite-800 rounded-sm border border-graphite-700">
                {mod.scenarios.map((scenario) => (
                  <li key={scenario.scenarioId} className="px-3 py-2">
                    <p className="flex items-center gap-2 text-xs text-zinc-200">
                      {scenario.name}
                      {scenario.gameMode && <Badge>{scenario.gameMode}</Badge>}
                      {scenario.playerCount && (
                        <span className="numeric text-2xs text-slate-dim">
                          {scenario.playerCount} players
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-2xs text-slate-faint">
                      {scenario.scenarioId}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="eyebrow">{label}</dt>
      <dd className={`truncate text-right text-xs text-zinc-200 ${mono ? 'font-mono' : 'numeric'}`}>
        {value}
      </dd>
    </div>
  );
}
