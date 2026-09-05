import { useMemo, useState } from 'react';
import type { CurrentUser, Role } from '@reforger-panel/shared';
import { ROLES, ROLE_LABELS } from '@reforger-panel/shared';
import {
  useActivity,
  useKillfeed,
  useKnownPlayers,
  useLogHealth,
  usePlayers,
  usePrimaryServer,
  useSetUserRole,
  useUsers,
} from '../api/hooks.js';
import { formatDateTime, formatDuration, formatRelativeTime } from '../lib/format.js';
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  RoleBadge,
  SearchInput,
  Spinner,
} from '../components/ui.js';
import { ActivityList, CurrentPlayersCard } from '../components/widgets.js';
import { InvitesCard } from '../components/invites-card.js';

/* ---------------------------------------------------------------- players */

export function PlayersPage() {
  const server = usePrimaryServer();
  if (!server) return <Spinner />;
  return <PlayersBody slug={server.slug} />;
}

type PlayerSort = 'online' | 'last_seen' | 'playtime' | 'sessions' | 'name';

function PlayersBody({ slug }: { slug: string }) {
  const { data: online } = usePlayers(slug);
  const { data: known } = useKnownPlayers(slug);
  const [sort, setSort] = useState<PlayerSort>('online');
  const [query, setQuery] = useState('');

  const sortedPlayers = useMemo(() => {
    const players = (known?.players ?? []).filter((player) =>
      query ? player.displayName.toLowerCase().includes(query.toLowerCase()) : true,
    );
    return [...players].sort((a, b) => {
      if (sort === 'online') {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return b.lastSeenAt.localeCompare(a.lastSeenAt);
      }
      if (sort === 'last_seen') return b.lastSeenAt.localeCompare(a.lastSeenAt);
      if (sort === 'playtime') return b.totalPlaytimeSeconds - a.totalPlaytimeSeconds;
      if (sort === 'sessions') return b.totalSessions - a.totalSessions;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [known?.players, sort, query]);

  return (
    <div className="w-full space-y-4">
      <PageHeader title="Players" />
      <CurrentPlayersCard slug={slug} maxPlayers={online?.maxPlayers ?? null} />
      <Card
        title="All known players"
        action={
          <div className="flex items-center gap-2">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Find a player…"
              className="w-44"
            />
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as PlayerSort)}
              className="input w-auto py-1 text-xs"
            >
              <option value="online">Online first</option>
              <option value="last_seen">Last seen</option>
              <option value="playtime">Playtime</option>
              <option value="sessions">Sessions</option>
              <option value="name">Name</option>
            </select>
          </div>
        }
      >
        {!known ? (
          <Spinner />
        ) : sortedPlayers.length === 0 ? (
          <EmptyState
            icon="users"
            title={query ? 'No players match that name' : 'No players recorded yet'}
            hint={query ? undefined : 'Players are discovered from server log connect events.'}
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
                    <td className="font-medium text-zinc-100">
                      <span className="flex items-center gap-2">
                        {player.displayName}
                        {player.online && <Badge tone="ok">online</Badge>}
                      </span>
                    </td>
                    <td className="font-mono text-2xs text-slate-faint">
                      {player.externalPlayerId ? (
                        `${player.externalPlayerId.slice(0, 12)}…`
                      ) : (
                        <span title="No stable ID in logs; matched by display name">name only</span>
                      )}
                    </td>
                    <td className="numeric text-slate-ink">
                      {formatRelativeTime(player.lastSeenAt)}
                    </td>
                    <td className="numeric text-right text-xs">{player.totalSessions}</td>
                    <td className="numeric text-right text-xs">
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

/* --------------------------------------------------------------- killfeed */

export function KillfeedPage() {
  const server = usePrimaryServer();
  if (!server) return <Spinner />;
  return <KillfeedBody slug={server.slug} />;
}

function teamClass(team: string | null): string {
  const normalized = team?.toLowerCase() ?? '';
  if (normalized.includes('blue') || normalized.includes('blufor')) return 'bg-info-400';
  if (normalized.includes('opfor') || normalized.includes('red')) return 'bg-danger-400';
  if (normalized.includes('independent') || normalized.includes('green')) return 'bg-ok-400';
  return 'bg-slate-faint';
}

function positionLabel(position: { x: number; y: number; z?: number | null } | null): string {
  if (!position) return 'position unknown';
  const z = typeof position.z === 'number' ? `, ${position.z.toFixed(0)}` : '';
  return `${position.x.toFixed(0)}, ${position.y.toFixed(0)}${z}`;
}

function KillfeedBody({ slug }: { slug: string }) {
  const { data, isLoading } = useKillfeed(slug, 150);
  return (
    <div className="w-full space-y-4">
      <PageHeader
        title="Killfeed"
        kicker="Parsed from ServerAdminTools kill events. Team, position, distance, and weapon show when the log line provides them."
      />
      <Card title="Recent kills">
        {isLoading || !data ? (
          <Spinner />
        ) : data.events.length === 0 ? (
          <EmptyState
            icon="crosshair"
            title="No kills recorded yet"
            hint="Killfeed requires ServerAdminTools kill event lines in the server log."
          />
        ) : (
          <ul className="space-y-1.5">
            {data.events.map((event) => (
              <li
                key={event.id}
                className="rounded-sm border border-graphite-800 bg-graphite-950/40 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={`h-2 w-2 rounded-full ${teamClass(event.killerTeam)}`} />
                  <span className="font-medium text-zinc-100">{event.killerName}</span>
                  <span className="text-slate-dim">killed</span>
                  <span className={`h-2 w-2 rounded-full ${teamClass(event.victimTeam)}`} />
                  <span className="font-medium text-zinc-100">{event.victimName}</span>
                  {event.friendly && <Badge tone="warn">friendly</Badge>}
                </div>
                <div className="numeric mt-1 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-slate-dim">
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

/* --------------------------------------------------------------- activity */

export function ActivityPage() {
  const server = usePrimaryServer();
  if (!server) return <Spinner />;
  return <ActivityBody slug={server.slug} />;
}

function ActivityBody({ slug }: { slug: string }) {
  const { data } = useActivity(slug, 100);
  return (
    <div className="w-full space-y-4">
      <PageHeader title="Activity" kicker="Panel actions and parsed server events, newest last." />
      <Card padded={false} className="p-4">
        {data ? <ActivityList items={data.activity} maxHeight={640} /> : <Spinner />}
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------- settings */

export function SettingsPage({ user }: { user: CurrentUser }) {
  const isOwner = user.role === 'owner';
  const server = usePrimaryServer();
  const { data: users } = useUsers(isOwner);
  const { data: logs } = useLogHealth(server?.slug ?? '', isOwner && server !== undefined);
  const setRole = useSetUserRole();

  return (
    <div className="w-full space-y-4">
      <PageHeader
        title="Settings"
        kicker="Manage private Discord access and review the panel's integrations."
      />

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
            <p className="text-sm font-medium text-zinc-100">
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
            <ul className="space-y-1.5">
              {users.users.map((panelUser) => (
                <li
                  key={panelUser.id}
                  className="flex items-center justify-between gap-3 rounded-sm border border-graphite-800 bg-graphite-950/40 px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    {panelUser.avatarUrl ? (
                      <img src={panelUser.avatarUrl} alt="" className="h-7 w-7 rounded-full" />
                    ) : (
                      <span className="h-7 w-7 rounded-full bg-graphite-700" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm text-zinc-100">
                        {panelUser.displayName ?? panelUser.username}
                      </p>
                      <p className="text-2xs text-slate-dim">
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
                      className="input w-auto py-1 text-xs"
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
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-ink">Pterodactyl</dt>
              <dd>
                {logs?.configured ? (
                  <Badge tone="ok">configured</Badge>
                ) : (
                  <Badge>mock / not configured</Badge>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="shrink-0 text-slate-ink">Game log path</dt>
              <dd className="truncate font-mono text-2xs text-slate-dim">{logs?.logPath ?? '—'}</dd>
            </div>
          </dl>
          <p className="mt-3 text-2xs leading-5 text-slate-dim">
            Connection settings are managed through environment variables. Workshop metadata is
            fetched on demand and cached in the API process — there is no background polling.
          </p>
        </Card>
      )}
    </div>
  );
}
