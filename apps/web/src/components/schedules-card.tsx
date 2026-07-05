import { useEffect, useMemo, useState } from 'react';
import type { RestartScheduleInput, ServerScheduleSummary } from '@reforger-panel/shared';
import {
  useCreateRestartSchedule,
  useDeleteSchedule,
  useServerSchedules,
  useUpdateRestartSchedule,
} from '../api/hooks.js';
import { formatDateTime } from '../lib/format.js';
import { Button, Card, EmptyState, Spinner } from './ui.js';

const DAYS = [
  { value: '*', label: 'Every day' },
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
] as const;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function timeValue(schedule: ServerScheduleSummary): string {
  const hour = Number(schedule.hour);
  const minute = Number(schedule.minute);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return '09:00';
  return `${pad(hour)}:${pad(minute)}`;
}

function isRestartSchedule(schedule: ServerScheduleSummary): boolean {
  return schedule.tasks.some((task) => task.action === 'power' && task.payload === 'restart');
}

function describeSchedule(schedule: ServerScheduleSummary): string {
  const day = DAYS.find((d) => d.value === schedule.dayOfWeek)?.label ?? schedule.dayOfWeek;
  return `${day} at ${timeValue(schedule)}`;
}

function inputFromSchedule(schedule: ServerScheduleSummary): RestartScheduleInput {
  const [hour, minute] = timeValue(schedule).split(':').map(Number);
  return {
    name: schedule.name,
    isActive: schedule.isActive,
    minute: minute ?? 0,
    hour: hour ?? 9,
    dayOfWeek: DAYS.some((d) => d.value === schedule.dayOfWeek)
      ? (schedule.dayOfWeek as RestartScheduleInput['dayOfWeek'])
      : '*',
    onlyWhenOnline: schedule.onlyWhenOnline,
  };
}

const DEFAULT_INPUT: RestartScheduleInput = {
  name: 'Daily restart',
  isActive: true,
  minute: 0,
  hour: 9,
  dayOfWeek: '*',
  onlyWhenOnline: true,
};

export function SchedulesCard({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  const { data, isLoading, error } = useServerSchedules(slug, canEdit);
  const createSchedule = useCreateRestartSchedule(slug);
  const updateSchedule = useUpdateRestartSchedule(slug);
  const deleteSchedule = useDeleteSchedule(slug);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RestartScheduleInput>(DEFAULT_INPUT);
  const [message, setMessage] = useState<string | null>(null);

  const schedules = data?.schedules ?? [];
  const restartSchedules = useMemo(() => schedules.filter(isRestartSchedule), [schedules]);
  const editing = restartSchedules.find((schedule) => schedule.id === editingId) ?? null;

  useEffect(() => {
    if (editing) setForm(inputFromSchedule(editing));
  }, [editing]);

  if (!canEdit) return null;

  const submit = () => {
    setMessage(null);
    const options = {
      onSuccess: () => {
        setMessage(editingId ? 'Restart schedule updated.' : 'Restart schedule created.');
        setEditingId(null);
        setForm(DEFAULT_INPUT);
      },
      onError: (err: Error) => setMessage(err.message),
    };
    if (editingId) {
      updateSchedule.mutate({ id: editingId, input: form }, options);
      return;
    }
    createSchedule.mutate(form, options);
  };

  const busy = createSchedule.isPending || updateSchedule.isPending || deleteSchedule.isPending;

  return (
    <Card title="Restart schedules">
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <p className="text-sm text-danger-400">{error.message}</p>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            {restartSchedules.length === 0 ? (
              <EmptyState
                title="No restart schedules"
                hint="Create one here instead of switching back to Pterodactyl."
              />
            ) : (
              <ul className="space-y-2">
                {restartSchedules.map((schedule) => (
                  <li
                    key={schedule.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-graphite-800 bg-graphite-950/20 px-3.5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-200">{schedule.name}</p>
                      <p className="text-xs text-slate-dim">
                        {describeSchedule(schedule)} ·{' '}
                        {schedule.onlyWhenOnline ? 'only when online' : 'runs regardless'} ·{' '}
                        {schedule.isActive ? 'active' : 'paused'}
                      </p>
                      <p className="text-xs text-slate-dim">
                        next run {schedule.nextRunAt ? formatDateTime(schedule.nextRunAt) : '—'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setEditingId(schedule.id);
                          setMessage(null);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() =>
                          deleteSchedule.mutate(schedule.id, {
                            onSuccess: () => setMessage('Schedule deleted.'),
                            onError: (err) => setMessage(err.message),
                          })
                        }
                      >
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-md border border-graphite-800 bg-graphite-950/20 p-4">
            <h3 className="text-sm font-semibold text-zinc-200">
              {editingId ? 'Edit restart' : 'New restart'}
            </h3>
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs text-slate-dim">Name</span>
                <input
                  className="input w-full"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-dim">Time</span>
                  <input
                    className="input w-full"
                    type="time"
                    value={`${pad(form.hour)}:${pad(form.minute)}`}
                    onChange={(event) => {
                      const [hour, minute] = event.target.value.split(':').map(Number);
                      setForm({ ...form, hour: hour ?? 0, minute: minute ?? 0 });
                    }}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-dim">Day</span>
                  <select
                    className="input w-full"
                    value={form.dayOfWeek}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        dayOfWeek: event.target.value as RestartScheduleInput['dayOfWeek'],
                      })
                    }
                  >
                    {DAYS.map((day) => (
                      <option key={day.value} value={day.value}>
                        {day.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
                />
                Active
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={form.onlyWhenOnline}
                  onChange={(event) => setForm({ ...form, onlyWhenOnline: event.target.checked })}
                />
                Only run when server is online
              </label>
              <div className="flex items-center gap-2">
                <Button
                  variant="accent"
                  disabled={busy || form.name.trim() === ''}
                  onClick={submit}
                >
                  {busy ? 'Saving…' : editingId ? 'Save schedule' : 'Create schedule'}
                </Button>
                {editingId && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setEditingId(null);
                      setForm(DEFAULT_INPUT);
                      setMessage(null);
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
              {message && <p className="text-xs text-slate-dim">{message}</p>}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
