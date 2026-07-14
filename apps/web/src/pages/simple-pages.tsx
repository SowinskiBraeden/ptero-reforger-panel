import { useMemo, useState } from 'react';
import type { CurrentUser, Role } from '@reforger-panel/shared';
import { ROLES, ROLE_LABELS } from '@reforger-panel/shared';
import {
  useActivity,
  useConfiguration,
  useKnownPlayers,
  useKillfeed,
  useLogHealth,
  usePlayers,
  useServers,
  useSetUserRole,
  useUsers,
  useWorkshopHealth,
} from '../api/hooks.js';
import { formatDateTime, formatDuration, formatRelativeTime } from '../lib/format.js';
import { Card, EmptyState, RoleBadge, Spinner } from '../components/ui.js';
import { ActivityList, ConfigSummaryRows, CurrentPlayersCard } from '../components/widgets.js';
import { InvitesCard } from '../components/invites-card.js';
import { MissionCard } from '../components/mission-card.js';
import { PerformanceForm } from '../components/performance-form.js';
import { SchedulesCard } from '../components/schedules-card.js';
import { StartupVarsCard } from '../components/startup-vars-card.js';

function usePrimarySlug(): string | null {
  const { data } = useServers();
  return data?.servers[0]?.slug ?? null;
}

export function ConfigurationsPage({ user }: { user: CurrentUser }) {
  const slug = usePrimarySlug();
  if (!slug) return <Spinner />;
  return <ConfigurationsBody slug={slug} user={user} />;
}

function ConfigurationsBody({ slug, user }: { slug: string; user: CurrentUser }) {
  const { data: config } = useConfiguration(slug);
  const canEdit = user.capabilities.includes('config.edit');

  return (
    <div className="w-full space-y-5">
      <h1 className="page-title">Configuration</h1>
      <MissionCard slug={slug} canEdit={canEdit} />
      <PerformanceForm slug={slug} canEdit={canEdit} />
      {/*<SchedulesCard slug={slug} canEdit={canEdit} />*/}
      {canEdit && <StartupVarsCard slug={slug} />}
      <Card title="Full config summary (live from the server)">
        {config ? <ConfigSummaryRows config={config} /> : <Spinner />}
      </Card>
    </div>
  );
}

export function PlayersPage() {
  const slug = usePrimarySlug();
  if (!slug) return <Spinner />;
  return <PlayersBody slug={slug} />;
}

function PlayersBody({ slug }: { slug: string }) {
  const { data: online } = usePlayers(slug);
  const { data: known } = useKnownPlayers(slug);
  const [sort, setSort] = useState<'online' | 'last_seen' | 'playtime' | 'sessions' | 'name'>(
    'online',
  );
  const sortedPlayers = useMemo(() => {
    const players = [...(known?.players ?? [])];
    players.sort((a, b) => {
      if (sort === 'online') {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return b.lastSeenAt.localeCompare(a.lastSeenAt);
      }
      if (sort === 'last_seen') return b.lastSeenAt.localeCompare(a.lastSeenAt);
      if (sort === 'playtime') return b.totalPlaytimeSeconds - a.totalPlaytimeSeconds;
      if (sort === 'sessions') return b.totalSessions - a.totalSessions;
      return a.displayName.localeCompare(b.displayName);
    });
    return players;
  }, [known?.players, sort]);

  return (
    <div className="w-full space-y-5">
      <h1 className="page-title">Players</h1>
      <CurrentPlayersCard slug={slug} maxPlayers={online?.maxPlayers ?? null} />
      <Card
        title="All known players"
        action={
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as typeof sort)}
            className="input py-1.5 text-xs"
          >
            <option value="online">Online first</option>
            <option value="last_seen">Last seen</option>
            <option value="playtime">Playtime</option>
            <option value="sessions">Sessions</option>
            <option value="name">Name</option>
          </select>
        }
      >
        {!known ? (
          <Spinner />
        ) : known.players.length === 0 ? (
          <EmptyState
            title="No players recorded yet"
            hint="Players are discovered from server log connect events."
          />
        ) : (
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Identity</th>
                  <th>Last seen</th>
                  <th className="text-right">Sessions</th>
                  <th className="text-right">Playtime</th>
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map((player) => (
                  <tr key={player.id}>
                    <td className="py-2 font-medium text-zinc-200">
                      {player.displayName}
                      {player.online && (
                        <span className="ml-2 rounded bg-accent-600/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent-400">
                          online
                        </span>
                      )}
                    </td>
                    <td className="py-2 font-mono text-xs text-slate-dim">
                      {player.externalPlayerId ? (
                        player.externalPlayerId.slice(0, 12) + '…'
                      ) : (
                        <span title="No stable ID in logs; matched by display name">name only</span>
                      )}
                    </td>
                    <td className="py-2 text-slate-ink">{formatRelativeTime(player.lastSeenAt)}</td>
                    <td className="py-2 text-right font-mono text-xs">{player.totalSessions}</td>
                    <td className="py-2 text-right font-mono text-xs">
                      {formatDuration(player.totalPlaytimeSeconds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function ActivityPage() {
  const slug = usePrimarySlug();
  if (!slug) return <Spinner />;
  return <ActivityBody slug={slug} />;
}

export function KillfeedPage() {
  const slug = usePrimarySlug();
  if (!slug) return <Spinner />;
  return <KillfeedBody slug={slug} />;
}

function teamClass(team: string | null): string {
  const normalized = team?.toLowerCase() ?? '';
  if (normalized.includes('blue') || normalized.includes('blufor')) return 'bg-sky-500';
  if (normalized.includes('opfor') || normalized.includes('red')) return 'bg-red-500';
  if (normalized.includes('independent') || normalized.includes('green')) return 'bg-emerald-500';
  return 'bg-slate-dim';
}

function positionLabel(position: { x: number; y: number; z?: number | null } | null): string {
  if (!position) return 'position unknown';
  const z = typeof position.z === 'number' ? `, ${position.z.toFixed(0)}` : '';
  return `${position.x.toFixed(0)}, ${position.y.toFixed(0)}${z}`;
}

function KillfeedBody({ slug }: { slug: string }) {
  const { data, isLoading } = useKillfeed(slug, 150);
  return (
    <div className="w-full space-y-5">
      <div>
        <h1 className="page-title">Killfeed</h1>
        <p className="page-kicker">
          Parsed from ServerAdminTools kill events. Team, position, distance, and weapon show when
          the log line provides them.
        </p>
      </div>
      <Card title="Recent kills">
        {isLoading || !data ? (
          <Spinner />
        ) : data.events.length === 0 ? (
          <EmptyState
            title="No kills recorded yet"
            hint="Killfeed requires ServerAdminTools kill event lines in the server log."
          />
        ) : (
          <ul className="space-y-2">
            {data.events.map((event) => (
              <li
                key={event.id}
                className="rounded-md border border-graphite-800 bg-graphite-950/20 px-3.5 py-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={`h-2.5 w-2.5 rounded-full ${teamClass(event.killerTeam)}`} />
                  <span className="font-medium text-zinc-100">{event.killerName}</span>
                  <span className="text-slate-dim">killed</span>
                  <span className={`h-2.5 w-2.5 rounded-full ${teamClass(event.victimTeam)}`} />
                  <span className="font-medium text-zinc-100">{event.victimName}</span>
                  {event.friendly && (
                    <span className="rounded border border-warn-400/30 bg-warn-400/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warn-400">
                      friendly
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-dim">
                  <span>{formatDateTime(event.occurredAt)}</span>
                  <span>attacker {positionLabel(event.killerPosition)}</span>
                  <span>victim {positionLabel(event.victimPosition)}</span>
                  <span>
                    distance{' '}
                    {event.distanceMeters !== null ? `${event.distanceMeters.toFixed(0)} m` : '—'}
                  </span>
                  <span>weapon {event.weapon ?? '—'}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ActivityBody({ slug }: { slug: string }) {
  const { data } = useActivity(slug, 100);
  return (
    <div className="w-full space-y-5">
      <h1 className="page-title">Activity</h1>
      <Card>{data ? <ActivityList items={data.activity} maxHeight={560} /> : <Spinner />}</Card>
    </div>
  );
}

export function SettingsPage({ user }: { user: CurrentUser }) {
  const isOwner = user.role === 'owner';
  const slug = usePrimarySlug();
  const { data: users } = useUsers(isOwner);
  const { data: workshop } = useWorkshopHealth();
  const { data: logs } = useLogHealth(slug ?? '', isOwner && slug !== null);
  const setRole = useSetUserRole();

  return (
    <div className="w-full space-y-5">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="page-kicker">
          Manage private Discord access, server integrations, and the checks that matter before
          exposing the panel to friends.
        </p>
      </div>

      <Card title="Your account">
        <div className="flex items-center gap-3">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              className="h-11 w-11 rounded-full border border-graphite-600"
            />
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-graphite-600 bg-graphite-800 text-sm font-semibold text-zinc-300">
              {(user.displayName ?? user.username).slice(0, 1).toUpperCase()}
            </span>
          )}
          <div>
            <p className="text-sm font-medium text-zinc-200">
              {user.displayName ?? user.username}{' '}
              <span className="text-slate-dim">({user.username})</span>
            </p>
            <RoleBadge role={user.role} />
          </div>
        </div>
      </Card>

      {isOwner && (
        <Card title="Users & roles">
          {!users ? (
            <Spinner />
          ) : (
            <ul className="space-y-2">
              {users.users.map((panelUser) => (
                <li
                  key={panelUser.id}
                  className="flex items-center justify-between rounded-md border border-graphite-800 bg-graphite-950/20 px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    {panelUser.avatarUrl ? (
                      <img src={panelUser.avatarUrl} alt="" className="h-7 w-7 rounded-full" />
                    ) : (
                      <span className="h-7 w-7 rounded-full bg-graphite-700" />
                    )}
                    <div>
                      <p className="text-sm text-zinc-200">
                        {panelUser.displayName ?? panelUser.username}
                      </p>
                      <p className="text-xs text-slate-dim">
                        joined {formatDateTime(panelUser.createdAt)}
                      </p>
                    </div>
                  </div>
                  {panelUser.id === user.id ? (
                    <RoleBadge role={panelUser.role} />
                  ) : (
                    <select
                      value={panelUser.role}
                      onChange={(event) =>
                        setRole.mutate({ userId: panelUser.id, role: event.target.value as Role })
                      }
                      className="input px-2 py-1 text-xs"
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {isOwner && <InvitesCard />}

      {isOwner && (
        <Card title="Integrations">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-ink">Workshop API</dt>
              <dd className={workshop?.ok ? 'text-accent-400' : 'text-danger-400'}>
                {workshop
                  ? workshop.ok
                    ? `healthy (${workshop.latencyMs} ms)`
                    : 'unreachable'
                  : '—'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-ink">Pterodactyl</dt>
              <dd className="text-zinc-300">
                {logs?.configured ? 'configured' : 'mock / not configured'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-ink">Log path</dt>
              <dd className="font-mono text-xs text-zinc-300">{logs?.logPath ?? '—'}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-dim">
            Connection settings are managed through environment variables. Use real Pterodactyl
            client API credentials for production and keep mock mode off.
          </p>
        </Card>
      )}
    </div>
  );
}
