import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import type { Capability, CurrentUser } from '@reforger-panel/shared';
import { useLogout, useServers } from '../api/hooks.js';
import { RoleBadge, StatusBadge } from './ui.js';
import { PowerControls } from './widgets.js';

const NAV_ITEMS: {
  to: string;
  label: string;
  exact?: boolean;
  capability?: Capability;
}[] = [
  { to: '/', label: 'Overview', exact: true },
  { to: '/mods', label: 'Mods' },
  { to: '/configuration', label: 'Configuration' },
  { to: '/players', label: 'Players' },
  { to: '/killfeed', label: 'Killfeed' },
  { to: '/activity', label: 'Activity' },
  { to: '/logs', label: 'Logs', capability: 'ops.health.view' },
  { to: '/settings', label: 'Settings' },
];

export function Layout({ user }: { user: CurrentUser }) {
  const logout = useLogout();
  const { data: serversData } = useServers();
  const server = serversData?.servers[0];
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {navOpen && (
        <div
          aria-hidden
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex h-dvh w-56 shrink-0 flex-col border-r border-graphite-700/70 bg-graphite-900 transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          navOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex min-h-16 items-center border-b border-graphite-700/60 px-5">
          <div>
            <p className="text-[13px] font-semibold uppercase leading-tight tracking-[0.12em] text-zinc-100">
              DZR.TOOLS
            </p>
            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-dim">
              ARMA REFORGER OPS
            </p>
          </div>
        </div>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITEMS.filter(
            (item) => !item.capability || user.capabilities.includes(item.capability),
          ).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              onClick={() => setNavOpen(false)}
              className={({ isActive }) =>
                `block rounded-md border border-transparent px-3.5 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'border-graphite-700 bg-graphite-850 font-medium text-zinc-100'
                    : 'text-slate-ink hover:bg-graphite-800 hover:text-zinc-200'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-graphite-700/60 px-5 py-4">
          <div className="flex items-center gap-2.5">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt=""
                className="h-8 w-8 rounded-full border border-graphite-600"
              />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-graphite-700 text-sm font-semibold text-zinc-300">
                {(user.displayName ?? user.username).slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-zinc-200">{user.displayName ?? user.username}</p>
              <RoleBadge role={user.role} />
            </div>
            <button
              type="button"
              title="Log out"
              onClick={() =>
                logout.mutate(undefined, { onSuccess: () => window.location.reload() })
              }
              className="rounded-md border border-graphite-600 px-2 py-1 text-xs text-slate-ink transition-colors hover:border-danger-400/50 hover:text-danger-400"
            >
              Exit
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex min-h-16 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-graphite-700/60 bg-graphite-900/85 px-4 py-3 backdrop-blur sm:px-6">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setNavOpen(true)}
            className="rounded-md border border-graphite-600 p-2 text-slate-ink transition-colors hover:text-zinc-200 lg:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
              <path d="M4 6h16M4 12h16M4 18h16" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          {server ? (
            <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
              <div className="min-w-28 truncate">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-dim">Server</p>
                <h2 className="truncate text-base font-semibold text-zinc-100">{server.name}</h2>
              </div>
              <StatusBadge status={server.status} />
              <span className="hidden text-sm text-slate-ink md:inline">
                {server.onlinePlayerCount} / {server.maxPlayers ?? '—'} players
              </span>
            </div>
          ) : (
            <div className="flex-1" />
          )}
          {server && <PowerControls user={user} server={server} />}
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
