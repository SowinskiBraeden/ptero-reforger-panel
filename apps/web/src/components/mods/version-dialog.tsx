import { useState } from 'react';
import { useWorkshopModVersions } from '../../api/hooks.js';
import { formatBytes, formatDateTime } from '../../lib/format.js';
import { Badge, Button, Dialog, EmptyState, Field, Spinner } from '../ui.js';

/**
 * Pins a specific Workshop version, or clears the pin so the server tracks
 * whatever is current. Reforger only accepts versions that actually exist, so
 * the list is the primary control — but a manual field is kept for versions
 * the metadata API has not indexed yet.
 */
export function VersionDialog({
  open,
  modId,
  modName,
  currentVersion,
  latestVersion,
  onClose,
  onSelect,
}: {
  open: boolean;
  modId: string | null;
  modName: string;
  currentVersion: string | null;
  latestVersion: string | null;
  onClose: () => void;
  onSelect: (version: string | null) => void;
}) {
  const { data, isLoading, error } = useWorkshopModVersions(open ? modId : null);
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const applyManual = () => {
    const value = manual.trim();
    if (!value) {
      setManualError('Enter a version, or use "Track latest".');
      return;
    }
    if (!/^[\w.+-]{1,32}$/.test(value)) {
      setManualError('Versions may only contain letters, digits, dots, plus and dashes.');
      return;
    }
    onSelect(value);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="lg"
      title={`Version — ${modName}`}
      description={
        currentVersion
          ? `Currently pinned to ${currentVersion}.`
          : 'Currently unpinned: the server takes the latest version at boot.'
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="accent"
            icon="check"
            onClick={() => onSelect(null)}
            disabled={currentVersion === null}
          >
            Track latest
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Enter a version manually"
          hint="Use this when the version you need is newer than the metadata index."
          error={manualError}
        >
          <div className="flex gap-2">
            <input
              value={manual}
              placeholder={latestVersion ?? '1.0.0'}
              onChange={(event) => {
                setManual(event.target.value);
                setManualError(null);
              }}
              onKeyDown={(event) => event.key === 'Enter' && applyManual()}
              className={`input font-mono ${manualError ? 'input-error' : ''}`}
            />
            <Button onClick={applyManual}>Pin</Button>
          </div>
        </Field>

        <div>
          <p className="eyebrow mb-2">Published versions</p>
          {isLoading ? (
            <Spinner label="Loading version history…" />
          ) : error ? (
            <EmptyState
              icon="alert"
              title="Version history is unavailable"
              hint="The Workshop metadata service did not answer. You can still pin a version manually above."
            />
          ) : !data || data.versions.length === 0 ? (
            <EmptyState title="No published versions listed for this mod" />
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-sm border border-graphite-700">
              <table className="data-table w-full">
                <thead className="sticky top-0 bg-graphite-900">
                  <tr>
                    <th className="pl-3">Version</th>
                    <th>Game</th>
                    <th className="text-right">Size</th>
                    <th>Published</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.versions.map((version) => {
                    const active = version.version === currentVersion;
                    return (
                      <tr key={version.version}>
                        <td className="pl-3 font-mono text-xs text-zinc-100">
                          <span className="flex items-center gap-2">
                            {version.version}
                            {version.version === latestVersion && (
                              <Badge tone="accent">latest</Badge>
                            )}
                            {!version.approved && <Badge tone="warn">unapproved</Badge>}
                          </span>
                        </td>
                        <td className="numeric text-xs text-slate-dim">
                          {version.gameVersion ?? '—'}
                        </td>
                        <td className="numeric text-right text-xs text-slate-dim">
                          {version.sizeBytes ? formatBytes(version.sizeBytes) : '—'}
                        </td>
                        <td className="text-xs text-slate-dim">
                          {formatDateTime(version.createdAt)}
                        </td>
                        <td className="pr-3 text-right">
                          <Button
                            size="sm"
                            variant={active ? 'subtle' : 'accent'}
                            disabled={active}
                            onClick={() => onSelect(version.version)}
                          >
                            {active ? 'Pinned' : 'Pin'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
