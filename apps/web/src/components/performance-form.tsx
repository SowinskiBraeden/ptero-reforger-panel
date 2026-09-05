import { useMemo, useState } from 'react';
import type { PerformanceSettings, PerformanceSettingsPatch } from '@reforger-panel/shared';
import { usePerformanceSettings, useSetPerformanceSettings } from '../api/hooks.js';
import { Button, EmptyState, Spinner, useToast } from './ui.js';
import { Icon } from './icons.js';

type NumberKey = {
  [K in keyof PerformanceSettings]: PerformanceSettings[K] extends number | null ? K : never;
}[keyof PerformanceSettings];
type BooleanKey = {
  [K in keyof PerformanceSettings]: PerformanceSettings[K] extends boolean | null ? K : never;
}[keyof PerformanceSettings];

// Ranges/defaults from the Bohemia server-config reference. Blank fields are
// omitted from config.json so the game default applies.
// maxPlayers is deliberately absent: it is controlled via the MAX_PLAYERS
// startup variable to avoid two "max players" inputs on one page.
const NUMBER_FIELDS: { key: NumberKey; label: string; min: number; max: number; hint: string }[] = [
  {
    key: 'serverMaxViewDistance',
    label: 'Server view distance',
    min: 500,
    max: 10000,
    hint: 'metres · default 1600',
  },
  {
    key: 'networkViewDistance',
    label: 'Network view distance',
    min: 500,
    max: 5000,
    hint: 'metres · default 1500',
  },
  {
    key: 'serverMinGrassDistance',
    label: 'Min grass distance',
    min: 0,
    max: 150,
    hint: 'metres · 0 = client choice',
  },
  { key: 'aiLimit', label: 'AI limit', min: -1, max: 1000, hint: '-1 = unlimited' },
  {
    key: 'playerSaveTime',
    label: 'Player save interval',
    min: 1,
    max: 3600,
    hint: 'seconds · default 120',
  },
  {
    key: 'slotReservationTimeout',
    label: 'Slot reservation timeout',
    min: 5,
    max: 300,
    hint: 'seconds · default 60',
  },
];

const BOOLEAN_FIELDS: { key: BooleanKey; label: string; hint: string }[] = [
  { key: 'disableAI', label: 'Disable AI', hint: 'default: AI enabled' },
  { key: 'disableThirdPerson', label: 'Disable third person', hint: 'default: allowed' },
  { key: 'fastValidation', label: 'Fast validation', hint: 'default: enabled' },
  { key: 'battlEye', label: 'BattlEye', hint: 'default: enabled' },
  { key: 'lobbyPlayerSynchronise', label: 'Lobby player sync', hint: 'default: enabled' },
];

type FieldKey = NumberKey | BooleanKey;

function toText(value: number | boolean | null): string {
  return value === null ? '' : String(value);
}

/**
 * Curated, range-validated view of the performance settings.
 *
 * Only fields the user actually edits are submitted — the old form posted all
 * thirteen values on every save, so a form loaded before somebody else's change
 * silently reverted it on the next submit.
 */
export function PerformanceForm({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  const toast = useToast();
  const { data, isLoading, error, refetch } = usePerformanceSettings(slug);
  const save = useSetPerformanceSettings(slug);

  const [edits, setEdits] = useState<Map<FieldKey, string>>(new Map());
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});

  const baseline = data?.settings;

  const dirtyKeys = useMemo(
    () =>
      [...edits.entries()]
        .filter(([key, value]) => baseline && value !== toText(baseline[key]))
        .map(([key]) => key),
    [edits, baseline],
  );

  if (isLoading) return <Spinner label="Downloading config.json…" />;
  if (error || !data || !baseline) {
    return (
      <EmptyState
        icon="alert"
        title="Could not read the performance settings"
        hint={error?.message}
        action={
          <Button icon="refresh" onClick={() => void refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const valueOf = (key: FieldKey): string => edits.get(key) ?? toText(baseline[key]);
  const isDirty = (key: FieldKey) => dirtyKeys.includes(key);

  const set = (key: FieldKey, value: string) => {
    setEdits((current) => new Map(current).set(key, value));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = () => {
    const errors: Partial<Record<FieldKey, string>> = {};
    const patch: PerformanceSettingsPatch = {};

    for (const field of NUMBER_FIELDS) {
      if (!isDirty(field.key)) continue;
      const raw = valueOf(field.key).trim();
      if (raw === '') {
        patch[field.key] = null;
        continue;
      }
      const value = Number(raw);
      if (!Number.isInteger(value) || value < field.min || value > field.max) {
        errors[field.key] = `Must be a whole number between ${field.min} and ${field.max}.`;
        continue;
      }
      patch[field.key] = value;
    }
    for (const field of BOOLEAN_FIELDS) {
      if (!isDirty(field.key)) continue;
      const raw = valueOf(field.key);
      patch[field.key] = raw === '' ? null : raw === 'true';
    }

    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;

    save.mutate(
      { settings: patch, expectedRevision: data.revision, writeStartupVars: true },
      {
        onSuccess: (result) => {
          setEdits(new Map());
          void refetch();
          toast(
            result.changedFields.length > 0
              ? `Saved ${result.changedFields.length} change${result.changedFields.length === 1 ? '' : 's'}. Restart to apply.`
              : 'No changes to save.',
            'ok',
          );
        },
        onError: (saveError) => toast(saveError.message, 'danger'),
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
        {NUMBER_FIELDS.map((field) => (
          <FieldRow
            key={field.key}
            label={field.label}
            hint={`${field.min}–${field.max} · ${field.hint} · blank = game default`}
            dirty={isDirty(field.key)}
            error={fieldErrors[field.key]}
            onReset={() => set(field.key, toText(baseline[field.key]))}
          >
            <input
              type="number"
              inputMode="numeric"
              min={field.min}
              max={field.max}
              disabled={!canEdit}
              value={valueOf(field.key)}
              placeholder="default"
              onChange={(event) => set(field.key, event.target.value)}
              className={`input numeric w-32 ${fieldErrors[field.key] ? 'input-error' : ''}`}
            />
          </FieldRow>
        ))}

        {BOOLEAN_FIELDS.map((field) => (
          <FieldRow
            key={field.key}
            label={field.label}
            hint={field.hint}
            dirty={isDirty(field.key)}
            onReset={() => set(field.key, toText(baseline[field.key]))}
          >
            <select
              disabled={!canEdit}
              value={valueOf(field.key)}
              onChange={(event) => set(field.key, event.target.value)}
              className="input w-32"
            >
              <option value="">Game default</option>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </FieldRow>
        ))}
      </div>

      {canEdit && dirtyKeys.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-graphite-700 pt-3">
          <span className="text-xs text-warn-400">
            {dirtyKeys.length} field{dirtyKeys.length === 1 ? '' : 's'} changed
          </span>
          <div className="ml-auto flex gap-2">
            <Button onClick={() => setEdits(new Map())} disabled={save.isPending}>
              Discard
            </Button>
            <Button variant="accent" icon="upload" onClick={submit} loading={save.isPending}>
              Apply to server
            </Button>
          </div>
        </div>
      )}

      <p className="text-2xs leading-5 text-slate-dim">
        Values are validated against the Bohemia server-config reference and written directly to
        config.json (the previous file is kept as config.json.bak). Network and identity settings —
        bind address, ports, passwords — are never touched here. Changes apply on the next restart.
      </p>
    </div>
  );
}

function FieldRow({
  label,
  hint,
  dirty,
  error,
  onReset,
  children,
}: {
  label: string;
  hint: string;
  dirty: boolean;
  error?: string;
  onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 rounded-sm px-2 py-1.5 ${dirty ? 'bg-accent-600/[0.07]' : ''}`}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm text-zinc-100">
          {label}
          {dirty && (
            <button
              type="button"
              title="Revert to the value on the server"
              onClick={onReset}
              className="text-accent-400 hover:text-accent-300"
            >
              <Icon name="refresh" className="h-3 w-3" />
            </button>
          )}
        </p>
        <p className="text-2xs text-slate-dim">{hint}</p>
        {error && <p className="text-2xs text-danger-400">{error}</p>}
      </div>
      {children}
    </div>
  );
}
