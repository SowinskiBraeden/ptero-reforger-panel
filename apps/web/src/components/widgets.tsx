import { useState } from 'react';
import type {
  ActivityItem,
  Capability,
  ConfigurationResponse,
  CurrentUser,
  PlayersResponse,
  ServerSummary,
} from '@reforger-panel/shared';
import {
  useActivity,
  useLogHealth,
  useManualLogSync,
  usePlayers,
  usePowerAction,
  useWorkshopHealth,
} from '../api/hooks.js';
import { formatDateTime, formatDuration, formatRelativeTime } from '../lib/format.js';
import { Button, Card, EmptyState, Spinner } from './ui.js';

function can(user: CurrentUser, capability: Capability): boolean {
  return user.capabilities.includes(capability);
}

export function PowerControls({ user, server }: { user: CurrentUser; server: ServerSummary }) {
  const power = usePowerAction(server.slug);
  const [message, setMessage] = useState<string | null>(null);

  const run = (action: 'start' | 'stop' | 'restart') => {
    setMessage(null);
    power.mutate(action, {
      onSuccess: (result) =>
        setMessage(result.simulated ? `${action} simulated (mock mode)` : `${action} requested`),
      onError: (error) => setMessage(error.message),
    });
  };

  const canStart = can(user, 'server.power.start');
  const canStop = can(user, 'server.power.stop');
  const canRestart = can(user, 'server.power.restart');
  if (!canStart && !canStop && !canRestart) return null;

  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-2 md:w-auto">
      {canStart && (
        <Button
          variant="accent"
          disabled={power.isPending || server.status === 'online'}
          onClick={() => run('start')}
        >
          Start
        </Button>
      )}
      {canRestart && (
        <Button disabled={power.isPending} onClick={() => run('restart')}>
          Restart
        </Button>
      )}
      {canStop && (
        <Button
          variant="danger"
          disabled={power.isPending || server.status === 'offline'}
          onClick={() => run('stop')}
        >
          Stop
        </Button>
      )}
      {message && <span className="text-xs text-slate-dim">{message}</span>}
    </div>
  );
}

export function CurrentPlayersCard({
  slug,
  maxPlayers,
}: {
  slug: string;
  maxPlayers: number | null;
}) {
  const { data, isLoading } = usePlayers(slug);
  return (
    <Card
      title="Current players"
      action={
        data && (
          <span className="text-xs text-slate-dim">
            {data.stale ? (
              <span className="text-warn-400">data may be stale</span>
            ) : (
              <>last synchronized {formatRelativeTime(data.lastSyncedAt)}</>
            )}
          </span>
        )
      }
    >
      {isLoading || !data ? (
        <Spinner />
      ) : (
        <PlayersTable players={data} maxPlayers={maxPlayers ?? data.maxPlayers} />
      )}
    </Card>
  );
}

function PlayersTable({
  players,
  maxPlayers,
}: {
  players: PlayersResponse;
  maxPlayers: number | null;
}) {
  return (
    <div>
      <p className="mb-4 text-3xl font-semibold text-zinc-100">
        {players.onlineCount}
        <span className="text-base font-normal text-slate-dim"> / {maxPlayers ?? '—'} online</span>
      </p>
      {players.players.length === 0 ? (
        <EmptyState
          title="No players connected"
          hint="Player presence is reconstructed from server logs and updates on each sync."
        />
      ) : (
        <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Connected since</th>
                <th className="text-right">Session</th>
              </tr>
            </thead>
            <tbody>
              {players.players.map((player) => (
                <tr key={player.playerId}>
                  <td className="py-2 font-medium text-zinc-200">{player.displayName}</td>
                  <td className="py-2 text-slate-ink">{formatDateTime(player.connectedAt)}</td>
                  <td className="py-2 text-right font-mono text-xs text-accent-400">
                    {formatDuration(player.sessionDurationSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const ACTIVITY_COLORS: Record<string, string> = {
  player_connected: 'text-accent-400',
  player_disconnected: 'text-slate-ink',
  server_started: 'text-accent-400',
  server_stopped: 'text-warn-400',
  server_restart_detected: 'text-warn-400',
  log_sync_failed: 'text-danger-400',
};

function logTimestamp(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Log-style feed: monospace timestamps, fixed height, scrolls. */
export function ActivityList({
  items,
  maxHeight = 320,
}: {
  items: ActivityItem[];
  maxHeight?: number;
}) {
  if (items.length === 0) {
    return (
      <EmptyState title="No activity yet" hint="Panel actions and server events appear here." />
    );
  }
  return (
    <div
      className="overflow-y-auto rounded-md border border-graphite-800 bg-graphite-950/70 font-mono text-xs shadow-inner"
      style={{ maxHeight }}
    >
      <ul>
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-baseline gap-3 border-b border-graphite-800/60 px-3 py-1.5 last:border-0 hover:bg-graphite-850/80"
            title={new Date(item.occurredAt).toLocaleString()}
          >
            <span className="shrink-0 text-slate-dim">{logTimestamp(item.occurredAt)}</span>
            <span
              className={`min-w-0 flex-1 truncate ${ACTIVITY_COLORS[item.action] ?? 'text-zinc-300'}`}
            >
              {item.summary}
            </span>
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-slate-dim">
              {item.kind === 'panel_action' ? 'panel' : 'server'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RecentActivityCard({ slug, limit = 50 }: { slug: string; limit?: number }) {
  const { data, isLoading } = useActivity(slug, limit);
  return (
    <Card title="Recent activity">
      {isLoading || !data ? <Spinner /> : <ActivityList items={data.activity} />}
    </Card>
  );
}

/** Display form of a scenario id: just the file name, e.g. "23_Campaign.conf". */
export function shortScenario(scenarioId: string): string {
  const slash = scenarioId.lastIndexOf('/');
  return slash >= 0 ? scenarioId.slice(slash + 1) : scenarioId;
}

export function ConfigSummaryRows({ config }: { config: ConfigurationResponse }) {
  const c = config.config;
  const rows: [string, string][] = [
    ['Mission', shortScenario(c.scenarioId)],
    ['Max players', String(c.maxPlayers)],
    // Reforger uses -1 for "no AI limit".
    ['AI limit', c.aiLimit < 0 ? 'Unlimited' : String(c.aiLimit)],
    ['View distance', `${c.serverMaxViewDistance} m (network ${c.networkViewDistance} m)`],
    ['Third person', c.disableThirdPerson ? 'Disabled' : 'Allowed'],
    ['Cross-platform', c.crossPlatform ? 'Enabled' : 'Disabled'],
    ['Mods', `${c.mods.length}`],
  ];
  return (
    <dl className="space-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4">
          <dt className="shrink-0 text-xs uppercase tracking-wider text-slate-dim">{label}</dt>
          <dd
            className="truncate text-right font-mono text-xs text-zinc-300"
            title={label === 'Mission' ? c.scenarioId : value}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function OpsHealthCard({ user, slug }: { user: CurrentUser; slug: string }) {
  const visible = can(user, 'ops.health.view');
  const { data: workshop } = useWorkshopHealth();
  const { data: logs } = useLogHealth(slug, visible);
  const syncNow = useManualLogSync(slug);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  if (!visible) return null;

  return (
    <Card
      title="Operational health"
      action={
        can(user, 'logs.sync') && (
          <Button
            disabled={syncNow.isPending || logs?.configured === false}
            onClick={() =>
              syncNow.mutate(undefined, {
                onSuccess: (result) =>
                  setSyncMessage(
                    `Synced: ${result.processedLines} lines, ${result.createdEvents} new events`,
                  ),
                onError: (error) => setSyncMessage(error.message),
              })
            }
          >
            {syncNow.isPending ? 'Syncing…' : 'Sync logs now'}
          </Button>
        )
      }
    >
      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-slate-ink">Workshop API</dt>
          <dd>
            {workshop ? (
              workshop.ok ? (
                <span className="text-accent-400">
                  healthy · {workshop.latencyMs} ms · {formatRelativeTime(workshop.checkedAt)}
                </span>
              ) : (
                <span className="text-danger-400" title={workshop.message ?? undefined}>
                  unreachable
                </span>
              )
            ) : (
              <span className="text-slate-dim">checking…</span>
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-ink">Log ingestion</dt>
          <dd>
            {!logs ? (
              <span className="text-slate-dim">checking…</span>
            ) : !logs.configured ? (
              <span className="text-slate-dim">not configured</span>
            ) : logs.stale ? (
              <span className="text-warn-400">stale</span>
            ) : (
              <span className="text-accent-400">healthy</span>
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-ink">Last successful sync</dt>
          <dd className="text-zinc-300">
            {formatRelativeTime(logs?.lastSuccessfulSyncAt ?? null)}
          </dd>
        </div>
        {logs?.lastSync && (
          <div className="flex items-center justify-between">
            <dt className="text-slate-ink">Last sync processed</dt>
            <dd className="font-mono text-xs text-zinc-300">
              {logs.lastSync.processedLines} lines · {logs.lastSync.createdEvents} events
            </dd>
          </div>
        )}
        {logs?.lastErrorMessage && (
          <div className="flex items-center justify-between gap-4">
            <dt className="shrink-0 text-slate-ink">Last sync error</dt>
            <dd
              className="truncate text-xs text-danger-400"
              title={`${formatRelativeTime(logs.lastErrorAt)}: ${logs.lastErrorMessage}`}
            >
              {logs.lastErrorMessage}
            </dd>
          </div>
        )}
        {syncMessage && <p className="text-xs text-slate-dim">{syncMessage}</p>}
      </dl>
    </Card>
  );
}
