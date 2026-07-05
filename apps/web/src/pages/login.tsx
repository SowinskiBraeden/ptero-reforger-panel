import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

function DiscordMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.1 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.291.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
    </svg>
  );
}

export function LoginPage() {
  const [devError, setDevError] = useState<string | null>(null);
  const { data: options } = useQuery({
    queryKey: ['auth', 'options'],
    queryFn: () => api.get<{ discord: boolean; devLogin: boolean }>('/api/auth/options'),
    staleTime: Infinity,
  });

  // Invite links land here before login; stash the code so it can be redeemed
  // automatically right after the Discord round-trip.
  const inviteCode = new URLSearchParams(window.location.search).get('invite');
  if (inviteCode) {
    localStorage.setItem('rp_invite', inviteCode);
  }
  const pendingInvite = inviteCode ?? localStorage.getItem('rp_invite');

  const devLogin = async () => {
    try {
      await api.post('/api/auth/dev-login');
      window.location.reload();
    } catch {
      setDevError('Dev login is not enabled (set DEV_AUTH_BYPASS=true locally).');
    }
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[38rem] w-[38rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-500/10 blur-3xl"
      />
      <div className="relative w-full max-w-sm rounded-lg border border-graphite-700/70 bg-graphite-900 p-8 shadow-xl shadow-black/40">
        <div
          aria-hidden
          className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-accent-500/50 to-transparent"
        />
        <div className="mb-8 text-center">
          <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-lg border border-graphite-600 bg-graphite-850 font-mono text-lg font-bold tracking-tight text-accent-400 shadow-inner shadow-black/30">
            DZR
          </span>
          <h1 className="text-xl font-semibold uppercase tracking-[0.14em] text-zinc-100">
            DZR.TOOLS
          </h1>
          <p className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.24em] text-slate-dim">
            Arma Reforger Ops
          </p>
        </div>
        {pendingInvite && (
          <p className="mb-4 rounded-md border border-accent-600/40 bg-accent-600/10 px-3 py-2.5 text-center text-xs font-medium text-accent-400">
            Invite detected. Sign in with Discord and the role will be applied automatically.
          </p>
        )}
        <a
          href="/api/auth/discord"
          className="flex w-full items-center justify-center gap-2.5 rounded-md bg-[#5865F2] px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          <DiscordMark className="h-5 w-5" />
          Continue with Discord
        </a>
        {options?.devLogin && (
          <button
            type="button"
            onClick={() => void devLogin()}
            className="mt-3 w-full rounded-md border border-graphite-600 px-4 py-2.5 text-center text-xs font-medium text-slate-dim transition-colors hover:text-zinc-300"
          >
            Local development login
          </button>
        )}
        {devError && <p className="mt-2 text-center text-xs text-danger-400">{devError}</p>}
      </div>
    </div>
  );
}
