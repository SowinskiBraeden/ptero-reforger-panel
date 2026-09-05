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
} from '../api/hooks.js';
import { formatDateTime, formatDuration, formatRelativeTime } from '../lib/format.js';
import { Badge, Button, Card, EmptyState, Spinner, useToast } from './ui.js';
import { shortScenario } from './mission-card.js';

function can(user: CurrentUser, capability: Capability): boolean {
  return user.capabilities.includes(capability);
}

export function PowerControls({ user, server }: { user: CurrentUser; server: ServerSummary }) {
  const power = usePowerAction(server.slug);
  const toast = useToast();

  const run = (action: 'start' | 'stop' | 'restart') => {
    power.mutate(action, {
      onSuccess: (result) =>
        toast(
          result.simulated
            ? `${action} simulated (mock mode) — watch the Console`
            : `${action} requested — watch the Console for live output`,
          'ok',
        ),
      onError: (error) => toast(error.message, 'danger'),
    });
  };

  const canStart = can(user, 'server.power.start');
  const canStop = can(user, 'server.power.stop');
  const canRestart = can(user, 'server.power.restart');
  if (!canStart && !canStop && !canRestart) return null;

  const busy = power.isPending || server.status === 'starting' || server.status === 'stopping';

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {canStart && (
        <Button
          size="sm"
          variant="accent"
          icon="play"
          disabled={busy || server.status === 'online'}
          onClick={() => run('start')}
        >
          Start
        </Button>
      )}
      {canRestart && (
        <Button size="sm" icon="restart" disabled={busy} onClick={() => run('restart')}>
          Restart
        </Button>
      )}
      {canStop && (
        <Button
          size="sm"
          variant="danger"
          icon="stop"
          disabled={busy || server.status === 'offline'}
          onClick={() => run('stop')}
        >
          Stop
        </Button>
      )}
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
          <span className="text-2xs text-slate-dim">
            {data.stale ? (
              <span className="text-warn-400">data may be stale</span>
            ) : (
              <>synced {formatRelativeTime(data.lastSyncedAt)}</>
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
      <p className="numeric mb-4 text-3xl font-semibold leading-none text-zinc-50">
        {players.onlineCount}
        <span className="text-sm font-normal text-slate-dim"> / {maxPlayers ?? '—'} online</span>
      </p>
      {players.players.length === 0 ? (
        <EmptyState
          icon="users"
          title="No players connected"
          hint="Player presence is reconstructed from the server log and updates on each sync."
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
                  <td className="font-medium text-zinc-100">{player.displayName}</td>
                  <td className="numeric text-slate-ink">{formatDateTime(player.connectedAt)}</td>
                  <td className="numeric text-right text-xs text-accent-400">
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
  player_connected: 'text-ok-400',
  player_disconnected: 'text-slate-ink',
  server_started: 'text-ok-400',
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
      <EmptyState
        icon="pulse"
        title="No activity yet"
        hint="Panel actions and server events appear here."
      />
    );
  }
  return (
    <div className="console-surface overflow-y-auto" style={{ maxHeight }}>
      <ul>
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-baseline gap-3 border-b border-graphite-800/60 px-3 py-1.5 last:border-0 hover:bg-graphite-900/70"
            title={new Date(item.occurredAt).toLocaleString()}
          >
            <span className="numeric shrink-0 text-slate-faint">
              {logTimestamp(item.occurredAt)}
            </span>
            <span
              className={`min-w-0 flex-1 truncate ${ACTIVITY_COLORS[item.action] ?? 'text-zinc-300'}`}
            >
              {item.summary}
            </span>
            <span className="shrink-0 text-2xs uppercase tracking-wider text-slate-faint">
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

export function ConfigSummaryRows({ config }: { config: ConfigurationResponse }) {
  const c = config.config;
  const rows: [string, string, string?][] = [
    ['Mission', shortScenario(c.scenarioId), c.scenarioId],
    ['Max players', String(c.maxPlayers)],
    // Reforger uses -1 for "no AI limit".
    ['AI limit', c.aiLimit < 0 ? 'Unlimited' : String(c.aiLimit)],
    ['View distance', `${c.serverMaxViewDistance} m`],
    ['Network view distance', `${c.networkViewDistance} m`],
    ['Third person', c.disableThirdPerson ? 'Disabled' : 'Allowed'],
    ['Cross-platform', c.crossPlatform ? 'Enabled' : 'Disabled'],
    ['Mods', String(c.mods.length)],
  ];
  return (
    <dl className="space-y-1.5">
      {rows.map(([label, value, title]) => (
        <div key={label} className="flex items-baseline justify-between gap-4">
          <dt className="eyebrow shrink-0">{label}</dt>
          <dd className="numeric truncate text-right text-xs text-zinc-200" title={title ?? value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Log-ingestion diagnostics. The reforgermods.net probe that used to sit here
 * was removed: it polled every minute, told nobody anything actionable, and
 * the Workshop cache degrades gracefully on its own.
 */
export function OpsHealthCard({ user, slug }: { user: CurrentUser; slug: string }) {
  const visible = can(user, 'ops.health.view');
  const { data: logs } = useLogHealth(slug, visible);
  const syncNow = useManualLogSync(slug);
  const toast = useToast();
  if (!visible) return null;

  return (
    <Card
      title="Log ingestion"
      action={
        can(user, 'logs.sync') && (
          <Button
            size="sm"
            icon="refresh"
            loading={syncNow.isPending}
            disabled={logs?.configured === false}
            onClick={() =>
              syncNow.mutate(undefined, {
                onSuccess: (result) =>
                  toast(
                    `Synced ${result.processedLines} lines, ${result.createdEvents} new events`,
                    'ok',
                  ),
                onError: (error) => toast(error.message, 'danger'),
              })
            }
          >
            Sync now
          </Button>
        )
      }
    >
      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-slate-ink">Status</dt>
          <dd>
            {!logs ? (
              <span className="text-slate-dim">checking…</span>
            ) : !logs.configured ? (
              <Badge>not configured</Badge>
            ) : logs.stale ? (
              <Badge tone="warn">stale</Badge>
            ) : (
              <Badge tone="ok">healthy</Badge>
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-slate-ink">Last successful sync</dt>
          <dd className="numeric text-xs text-zinc-200">
            {formatRelativeTime(logs?.lastSuccessfulSyncAt ?? null)}
          </dd>
        </div>
        {logs?.lastSync && (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-slate-ink">Last sync processed</dt>
            <dd className="numeric text-xs text-zinc-200">
              {logs.lastSync.processedLines} lines · {logs.lastSync.createdEvents} events
            </dd>
          </div>
        )}
        {logs?.logPath && (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-slate-ink">Log file</dt>
            <dd className="truncate font-mono text-2xs text-slate-dim" title={logs.logPath}>
              {logs.logPath}
            </dd>
          </div>
        )}
        {logs?.lastErrorMessage && (
          <div className="flex items-center justify-between gap-4">
            <dt className="shrink-0 text-slate-ink">Last error</dt>
            <dd
              className="truncate text-xs text-danger-400"
              title={`${formatRelativeTime(logs.lastErrorAt)}: ${logs.lastErrorMessage}`}
            >
              {logs.lastErrorMessage}
            </dd>
          </div>
        )}
      </dl>
    </Card>
  );
}
