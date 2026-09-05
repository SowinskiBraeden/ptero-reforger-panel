import { useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useCurrentUser } from './api/hooks.js';
import { api, ApiClientError } from './api/client.js';
import { Layout } from './components/layout.js';
import { EmptyState, Spinner, ToastProvider } from './components/ui.js';
import { LoginPage } from './pages/login.js';
import { OverviewPage } from './pages/overview.js';
import { ModsPage } from './pages/mods.js';
import { ConfigurationPage } from './pages/configuration.js';
import { MissionPage } from './pages/mission.js';
import { ConsolePage } from './pages/console.js';
import { ActivityPage, KillfeedPage, PlayersPage, SettingsPage } from './pages/simple-pages.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Config and mod reads hit the game server; do not re-fetch them just
      // because a tab regained focus.
      refetchOnWindowFocus: false,
      retry: (failureCount, error) =>
        !(error instanceof ApiClientError && error.status >= 400 && error.status < 500) &&
        failureCount < 2,
    },
  },
});

/** Redeems a stored invite code once, right after login, then refreshes /me. */
function InviteRedeemer() {
  const client = useQueryClient();
  useEffect(() => {
    const code = localStorage.getItem('rp_invite');
    if (!code) return;
    localStorage.removeItem('rp_invite');
    void api
      .post('/api/invites/redeem', { code })
      .then(() => client.invalidateQueries({ queryKey: ['auth', 'me'] }))
      .catch(() => undefined); // invalid/expired codes fail quietly
  }, [client]);
  return null;
}

function AuthGate() {
  const { data: user, isLoading, error } = useCurrentUser();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Checking session…" />
      </div>
    );
  }
  if (error instanceof ApiClientError && error.status === 401) {
    return <LoginPage />;
  }
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <EmptyState
          icon="alert"
          title="Could not reach the panel API"
          hint="Is the backend running?"
        />
      </div>
    );
  }

  return (
    <>
      <InviteRedeemer />
      <Routes>
        <Route element={<Layout user={user} />}>
          <Route index element={<OverviewPage user={user} />} />
          <Route path="/mods" element={<ModsPage user={user} />} />
          <Route path="/configuration" element={<ConfigurationPage user={user} />} />
          <Route path="/mission" element={<MissionPage user={user} />} />
          <Route path="/players" element={<PlayersPage />} />
          <Route path="/killfeed" element={<KillfeedPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/console" element={<ConsolePage />} />
          <Route path="/settings" element={<SettingsPage user={user} />} />
          {/* Old bookmarks. */}
          <Route path="/logs" element={<Navigate to="/console" replace />} />
          <Route path="/server/:slug" element={<Navigate to="/" replace />} />
          <Route path="/configurations" element={<Navigate to="/configuration" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <AuthGate />
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
