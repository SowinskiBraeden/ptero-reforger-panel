import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import type { Capability, CurrentUser } from '@reforger-panel/shared';
import {
  useLogout,
  useModsOverview,
  usePlayers,
  useServerResources,
  useServers,
} from '../api/hooks.js';
import { formatDuration } from '../lib/format.js';
import { IconButton, RoleBadge, StatusBadge } from './ui.js';
import { Icon, type IconName } from './icons.js';
import { PowerControls } from './widgets.js';

const NAV_ITEMS: {
  to: string;
  label: string;
  icon: IconName;
  exact?: boolean;
  capability?: Capability;
}[] = [
  { to: '/', label: 'Overview', icon: 'gauge', exact: true },
  { to: '/mods', label: 'Mods', icon: 'package' },
  { to: '/configuration', label: 'Configuration', icon: 'sliders' },
  { to: '/mission', label: 'Mission', icon: 'map' },
  { to: '/players', label: 'Players', icon: 'users' },
  { to: '/killfeed', label: 'Killfeed', icon: 'crosshair' },
  { to: '/activity', label: 'Activity', icon: 'pulse' },
  { to: '/console', label: 'Console', icon: 'terminal', capability: 'ops.health.view' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export function Layout({ user }: { user: CurrentUser }) {
  const logout = useLogout();
  const { data: serversData } = useServers();
  const server = serversData?.servers[0];
  const slug = server?.slug ?? '';
  const { data: resources } = useServerResources(slug, Boolean(slug));
  const { data: players } = usePlayers(slug);
  const { data: mods } = useModsOverview(slug);
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  // Close the drawer on navigation so a tap never leaves it hanging open.
  useEffect(() => setNavOpen(false), [location.pathname]);

  const counts: Partial<Record<string, number>> = {
    '/mods': mods?.mods.length,
    '/players': players?.onlineCount,
  };

  return (
    <div className="flex min-h-screen">
      {navOpen && (
        <div
          aria-hidden
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-20 bg-black/70 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-30 flex h-dvh w-56 shrink-0 flex-col border-r border-graphite-700 bg-graphite-900 transition-transform duration-150 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          navOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex min-h-14 items-center gap-2.5 border-b border-graphite-700 px-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-sm border border-accent-600/50 bg-accent-600/15 text-accent-400">
            <Icon name="server" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase leading-tight tracking-[0.14em] text-zinc-100">
              DZR.TOOLS
            </p>
            <p className="text-2xs uppercase leading-tight tracking-[0.16em] text-slate-faint">
              Reforger Ops
            </p>
          </div>
        </div>

        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV_ITEMS.filter(
            (item) => !item.capability || user.capabilities.includes(item.capability),
          ).map((item) => {
            const count = counts[item.to];
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.exact}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-sm border-l-2 px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'border-accent-500 bg-graphite-850 font-medium text-zinc-50'
                      : 'border-transparent text-slate-ink hover:bg-graphite-850/60 hover:text-zinc-100'
                  }`
                }
              >
                <Icon name={item.icon} className="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {count !== undefined && count > 0 && (
                  <span className="numeric text-2xs text-slate-faint">{count}</span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-graphite-700 px-3 py-3">
          <div className="flex items-center gap-2.5">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt=""
                className="h-8 w-8 rounded-full border border-graphite-600"
              />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-graphite-600 bg-graphite-800 text-sm font-semibold text-zinc-300">
                {(user.displayName ?? user.username).slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-zinc-200">{user.displayName ?? user.username}</p>
              <RoleBadge role={user.role} />
            </div>
            <IconButton
              icon="exit"
              label="Log out"
              onClick={() =>
                logout.mutate(undefined, { onSuccess: () => window.location.reload() })
              }
              size="sm"
            />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-graphite-700 bg-graphite-900/90 px-4 py-2.5 backdrop-blur sm:px-6">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setNavOpen(true)}
            className="rounded-sm border border-graphite-600 p-1.5 text-slate-ink transition-colors hover:text-zinc-100 lg:hidden"
          >
            <Icon name="menu" className="h-4 w-4" />
          </button>

          {server ? (
            <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-5">
              <div className="min-w-0">
                <p className="eyebrow leading-tight">Server</p>
                <h2 className="truncate text-sm font-semibold leading-tight text-zinc-50">
                  {server.name}
                </h2>
              </div>
              <StatusBadge status={server.status} />
              <dl className="hidden items-center gap-5 md:flex">
                <HeaderStat
                  label="Players"
                  value={`${server.onlinePlayerCount} / ${server.maxPlayers ?? '—'}`}
                />
                <HeaderStat
                  label="Uptime"
                  value={
                    resources && resources.uptimeMs > 0
                      ? formatDuration(resources.uptimeMs / 1000)
                      : '—'
                  }
                />
                <HeaderStat
                  label="CPU"
                  value={resources ? `${resources.cpuPercent.toFixed(0)}%` : '—'}
                />
              </dl>
            </div>
          ) : (
            <div className="flex-1" />
          )}

          {server && <PowerControls user={user} server={server} />}
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow leading-tight">{label}</dt>
      <dd className="numeric text-sm leading-tight text-zinc-200">{value}</dd>
    </div>
  );
}
