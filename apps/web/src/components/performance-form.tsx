import { useEffect, useState } from 'react';
import type { PerformanceSettings } from '@reforger-panel/shared';
import { usePerformanceSettings, useSetPerformanceSettings } from '../api/hooks.js';
import { Button, Card, Spinner } from './ui.js';

type NumberKey = {
  [K in keyof PerformanceSettings]: PerformanceSettings[K] extends number | null ? K : never;
}[keyof PerformanceSettings];
type BooleanKey = Exclude<keyof PerformanceSettings, NumberKey>;

// Ranges/defaults from the Bohemia server-config reference. Blank fields are
// omitted from config.json so the game default applies.
// maxPlayers is deliberately absent: it is controlled via the MAX_PLAYERS
// startup variable to avoid two "max players" inputs on one page.
const NUMBER_FIELDS: { key: NumberKey; label: string; min: number; max: number; hint: string }[] = [
  {
    key: 'serverMaxViewDistance',
    label: 'Server view distance (m)',
    min: 500,
    max: 10000,
    hint: 'default 1600',
  },
  {
    key: 'networkViewDistance',
    label: 'Network view distance (m)',
    min: 500,
    max: 5000,
    hint: 'default 1500',
  },
  {
    key: 'serverMinGrassDistance',
    label: 'Min grass distance (m)',
    min: 0,
    max: 150,
    hint: '0 = client choice',
  },
  { key: 'aiLimit', label: 'AI limit', min: -1, max: 1000, hint: '-1 = unlimited' },
  {
    key: 'playerSaveTime',
    label: 'Player save interval (s)',
    min: 1,
    max: 3600,
    hint: 'default 120',
  },
  {
    key: 'slotReservationTimeout',
    label: 'Slot reservation timeout (s)',
    min: 5,
    max: 300,
    hint: 'default 60',
  },
];

const BOOLEAN_FIELDS: { key: BooleanKey; label: string; hint: string }[] = [
  { key: 'disableThirdPerson', label: 'Disable third person', hint: 'default disabled' },
  { key: 'fastValidation', label: 'Fast validation', hint: 'default enabled' },
  { key: 'battlEye', label: 'BattlEye', hint: 'default enabled' },
  { key: 'lobbyPlayerSynchronise', label: 'Lobby player sync', hint: 'default enabled' },
];

type FormState = Record<string, string>;

function toFormState(settings: PerformanceSettings): FormState {
  const state: FormState = {};
  for (const field of NUMBER_FIELDS) {
    const value = settings[field.key];
    state[field.key] = value === null ? '' : String(value);
  }
  for (const field of BOOLEAN_FIELDS) {
    const value = settings[field.key];
    state[field.key] = value === null ? '' : String(value);
  }
  return state;
}

export function PerformanceForm({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  const { data, isLoading, error: loadError } = usePerformanceSettings(slug);
  const save = useSetPerformanceSettings(slug);
  const [form, setForm] = useState<FormState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data && form === null) setForm(toFormState(data.settings));
  }, [data, form]);

  if (isLoading || (!form && !loadError)) return <Spinner label="Downloading config.json…" />;
  if (loadError) return <p className="text-sm text-danger-400">{loadError.message}</p>;
  if (!form || !data) return null;

  const baseline = toFormState(data.settings);
  const dirty = Object.keys(form).some((key) => form[key] !== baseline[key]);

  const set = (key: string, value: string) => {
    setMessage(null);
    setForm({ ...form, [key]: value });
  };

  const validateAndBuild = (): PerformanceSettings | null => {
    const errors: Record<string, string> = {};
    const result = {} as Record<string, number | boolean | null>;
    for (const field of NUMBER_FIELDS) {
      const raw = (form[field.key] ?? '').trim();
      if (raw === '') {
        result[field.key] = null;
        continue;
      }
      const value = Number(raw);
      if (!Number.isInteger(value) || value < field.min || value > field.max) {
        errors[field.key] = `Must be a whole number between ${field.min} and ${field.max}.`;
        continue;
      }
      result[field.key] = value;
    }
    for (const field of BOOLEAN_FIELDS) {
      const raw = form[field.key] ?? '';
      result[field.key] = raw === '' ? null : raw === 'true';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length > 0 ? null : (result as unknown as PerformanceSettings);
  };

  const submit = () => {
    const settings = validateAndBuild();
    if (!settings) return;
    save.mutate(settings, {
      onSuccess: (result) => {
        setForm(null); // re-derive from the fresh server response on next load
        setMessage(
          result.changedFields.length > 0
            ? `Saved ${result.changedFields.length} change${result.changedFields.length === 1 ? '' : 's'} to config.json — restart the server to apply.`
            : 'No changes to save.',
        );
      },
      onError: (saveError) => setMessage(saveError.message),
    });
  };

  const inputClass = (key: string) => `input w-32 ${fieldErrors[key] ? 'input-error' : ''}`;

  return (
    <Card
      title="Performance settings (config.json)"
      action={
        canEdit &&
        dirty && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-warn-400">unsaved changes</span>
            <Button onClick={() => setForm(toFormState(data.settings))} disabled={save.isPending}>
              Discard
            </Button>
            <Button variant="accent" onClick={submit} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save to server'}
            </Button>
          </div>
        )
      }
    >
      <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
        {NUMBER_FIELDS.map((field) => (
          <div key={field.key} className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-zinc-200">{field.label}</p>
              <p className="text-xs text-slate-dim">
                {field.min}–{field.max} · {field.hint} · blank = game default
              </p>
              {fieldErrors[field.key] && (
                <p className="text-xs text-danger-400">{fieldErrors[field.key]}</p>
              )}
            </div>
            <input
              type="number"
              inputMode="numeric"
              min={field.min}
              max={field.max}
              disabled={!canEdit}
              value={form[field.key] ?? ''}
              placeholder="default"
              onChange={(event) => set(field.key, event.target.value)}
              className={inputClass(field.key)}
            />
          </div>
        ))}
        {BOOLEAN_FIELDS.map((field) => (
          <div key={field.key} className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-zinc-200">{field.label}</p>
              <p className="text-xs text-slate-dim">{field.hint}</p>
            </div>
            <select
              disabled={!canEdit}
              value={form[field.key] ?? ''}
              onChange={(event) => set(field.key, event.target.value)}
              className="input w-32"
            >
              <option value="">Game default</option>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </div>
        ))}
      </div>
      {message && <p className="mt-4 text-xs text-accent-400">{message}</p>}
      <p className="mt-4 text-xs text-slate-dim">
        Values are validated against the ranges in the Bohemia server-config reference and written
        directly to config.json (backup kept as config.json.bak). Network/identity settings (bind
        address, ports, passwords) are never touched here. Changes apply on the next restart.
      </p>
    </Card>
  );
}
