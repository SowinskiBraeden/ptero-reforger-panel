import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActivityItem,
  ConfigurationResponse,
  CurrentUser,
  InviteSummary,
  KillfeedEvent,
  MissionsResponse,
  ModsCheckResponse,
  PerformanceSettingsPatch,
  PerformanceSettingsResponse,
  RawLogsResponse,
  RestartScheduleInput,
  ResourceHistoryResponse,
  StartupResponse,
  KnownPlayer,
  LogIngestionHealth,
  LogSyncResult,
  ModPackSummary,
  PanelUser,
  PlayersResponse,
  ReforgerConfigMod,
  ServerModsResponse,
  UpdateModsResult,
  ServerResources,
  ServerScheduleSummary,
  ServerSummary,
  WorkshopHealth,
  WorkshopModDetail,
  WorkshopSearchResponse,
} from '@reforger-panel/shared';
import { api, ApiClientError } from './client.js';

export function useCurrentUser() {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<CurrentUser>('/api/auth/me'),
    retry: (failureCount, error) =>
      !(error instanceof ApiClientError && error.status === 401) && failureCount < 2,
    staleTime: 60_000,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSuccess: () => queryClient.clear(),
  });
}

export function useServers() {
  return useQuery({
    queryKey: ['servers'],
    queryFn: () => api.get<{ servers: ServerSummary[] }>('/api/servers'),
    refetchInterval: 15_000,
  });
}

export function useServer(slug: string) {
  return useQuery({
    queryKey: ['servers', slug],
    queryFn: () => api.get<ServerSummary>(`/api/servers/${slug}`),
    refetchInterval: 15_000,
  });
}

export function useServerResources(slug: string, enabled = true) {
  return useQuery({
    queryKey: ['servers', slug, 'resources'],
    queryFn: () => api.get<ServerResources>(`/api/servers/${slug}/resources`),
    refetchInterval: 10_000,
    enabled,
  });
}

export function usePlayers(slug: string) {
  return useQuery({
    queryKey: ['servers', slug, 'players'],
    queryFn: () => api.get<PlayersResponse>(`/api/servers/${slug}/players`),
    refetchInterval: 15_000,
  });
}

export function useKnownPlayers(slug: string) {
  return useQuery({
    queryKey: ['servers', slug, 'players', 'known'],
    queryFn: () => api.get<{ players: KnownPlayer[] }>(`/api/servers/${slug}/players/known`),
    refetchInterval: 30_000,
  });
}

export function useActivity(slug: string, limit = 50) {
  return useQuery({
    queryKey: ['servers', slug, 'activity', limit],
    queryFn: () =>
      api.get<{ activity: ActivityItem[] }>(`/api/servers/${slug}/activity?limit=${limit}`),
    refetchInterval: 20_000,
  });
}

export function useKillfeed(slug: string, limit = 100) {
  return useQuery({
    queryKey: ['servers', slug, 'killfeed', limit],
    queryFn: () =>
      api.get<{ events: KillfeedEvent[] }>(`/api/servers/${slug}/killfeed?limit=${limit}`),
    refetchInterval: 10_000,
  });
}

export function useConfiguration(slug: string) {
  return useQuery({
    queryKey: ['servers', slug, 'configuration'],
    queryFn: () => api.get<ConfigurationResponse>(`/api/servers/${slug}/configuration`),
    // Live download from the game server on each fetch — keep it calm.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useMissions(slug: string) {
  return useQuery({
    queryKey: ['servers', slug, 'missions'],
    queryFn: () => api.get<MissionsResponse>(`/api/servers/${slug}/missions`),
    staleTime: 60_000,
  });
}

/**
 * Opens a persistent SSE connection to stream live console output line by line.
 * `onLine` is called for each received line. The connection closes and re-opens
 * automatically when the component unmounts or `slug` changes.
 */
export function useConsoleStream(slug: string, onLine: (line: string) => void, enabled: boolean) {
  const onLineRef = useRef(onLine);
  onLineRef.current = onLine;

  useEffect(() => {
    if (!enabled || !slug) return;
    const es = new EventSource(`/api/servers/${slug}/logs/stream`, { withCredentials: true });
    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const line = JSON.parse(e.data) as string;
        onLineRef.current(line);
      } catch {
        // ignore
      }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [slug, enabled]);
}

export function useRawLogs(slug: string, lines: number, autoRefresh: boolean, enabled: boolean) {
  return useQuery({
    queryKey: ['servers', slug, 'logs', 'raw', lines],
    queryFn: () => api.get<RawLogsResponse>(`/api/servers/${slug}/logs/raw?lines=${lines}`),
    refetchInterval: autoRefresh ? 10_000 : false,
    enabled,
  });
}

export function useStartupVariables(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: ['servers', slug, 'startup'],
    queryFn: () => api.get<StartupResponse>(`/api/servers/${slug}/startup`),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled,
  });
}

export function useUpdateStartupVariable(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { key: string; value: string }) =>
      api.put<{ ok: boolean; requiresRestart: boolean }>(
        `/api/servers/${slug}/startup/variable`,
        input,
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['servers', slug, 'startup'] }),
  });
}

export function useModPacks(slug: string) {
  return useQuery({
    queryKey: ['servers', slug, 'mod-packs'],
    queryFn: () => api.get<{ modPacks: ModPackSummary[] }>(`/api/servers/${slug}/mod-packs`),
  });
}

export function useLogHealth(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: ['servers', slug, 'logs', 'health'],
    queryFn: () => api.get<LogIngestionHealth>(`/api/servers/${slug}/logs/health`),
    refetchInterval: 20_000,
    enabled,
  });
}

export function usePowerAction(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart') =>
      api.post<{ ok: boolean; simulated: boolean }>(`/api/servers/${slug}/power/${action}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
  });
}

export function useResourceHistory(slug: string) {
  return useQuery({
    queryKey: ['servers', slug, 'resources', 'history'],
    queryFn: () => api.get<ResourceHistoryResponse>(`/api/servers/${slug}/resources/history`),
    refetchInterval: 15_000,
  });
}

export function usePerformanceSettings(slug: string) {
  return useQuery({
    queryKey: ['servers', slug, 'config', 'performance'],
    queryFn: () => api.get<PerformanceSettingsResponse>(`/api/servers/${slug}/config/performance`),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useSetPerformanceSettings(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: PerformanceSettingsPatch) =>
      api.put<PerformanceSettingsResponse & { changedFields: string[]; requiresRestart: boolean }>(
        `/api/servers/${slug}/config/performance`,
        settings,
      ),
    onSuccess: (result) => {
      queryClient.setQueryData(['servers', slug, 'config', 'performance'], result);
      void queryClient.invalidateQueries({ queryKey: ['servers', slug] });
    },
  });
}

export function useInvites(enabled: boolean) {
  return useQuery({
    queryKey: ['invites'],
    queryFn: () => api.get<{ invites: InviteSummary[] }>('/api/invites'),
    enabled,
  });
}

export function useCreateInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { role: string; expiresInHours?: number | null }) =>
      api.post<{ id: string; code: string; role: string; expiresAt: string }>(
        '/api/invites',
        input,
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['invites'] }),
  });
}

export function useDeleteInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/invites/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['invites'] }),
  });
}

export function useServerMods(slug: string) {
  return useQuery({
    queryKey: ['servers', slug, 'mods'],
    queryFn: () => api.get<ServerModsResponse>(`/api/servers/${slug}/mods`),
    // Each call downloads config.json from Pterodactyl — no background polling.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useSetServerMods(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mods: ReforgerConfigMod[]) =>
      api.put<UpdateModsResult>(`/api/servers/${slug}/mods`, { mods }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['servers', slug] });
    },
  });
}

export function useServerModsCheck(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: ['servers', slug, 'mods', 'check'],
    queryFn: () => api.get<ModsCheckResponse>(`/api/servers/${slug}/mods/check`),
    enabled,
    staleTime: 2 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useManualLogSync(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<LogSyncResult>(`/api/servers/${slug}/logs/sync`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['servers', slug] });
    },
  });
}

export function useServerSchedules(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: ['servers', slug, 'schedules'],
    queryFn: () =>
      api.get<{ schedules: ServerScheduleSummary[]; fetchedAt: string }>(
        `/api/servers/${slug}/schedules`,
      ),
    enabled,
    staleTime: 30_000,
  });
}

export function useCreateRestartSchedule(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RestartScheduleInput) =>
      api.post<{ schedule: ServerScheduleSummary }>(
        `/api/servers/${slug}/schedules/restarts`,
        input,
      ),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['servers', slug, 'schedules'] }),
  });
}

export function useUpdateRestartSchedule(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RestartScheduleInput }) =>
      api.put<{ schedule: ServerScheduleSummary }>(
        `/api/servers/${slug}/schedules/${id}/restart`,
        input,
      ),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['servers', slug, 'schedules'] }),
  });
}

export function useDeleteSchedule(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/servers/${slug}/schedules/${id}`),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['servers', slug, 'schedules'] }),
  });
}

export function useWorkshopHealth() {
  return useQuery({
    queryKey: ['workshop', 'health'],
    queryFn: () => api.get<WorkshopHealth>('/api/workshop/health'),
    refetchInterval: 60_000,
  });
}

export function useWorkshopSearch(query: string, page: number, sort?: string) {
  return useQuery({
    queryKey: ['workshop', 'search', query, page, sort],
    queryFn: () =>
      api.get<WorkshopSearchResponse>(
        `/api/workshop/search?q=${encodeURIComponent(query)}&page=${page}${
          sort ? `&sort=${encodeURIComponent(sort)}` : ''
        }`,
      ),
    // An empty query browses the Workshop front page (/v1/mods).
    placeholderData: (previous) => previous,
    staleTime: 5 * 60_000,
  });
}

export function useWorkshopMod(modId: string | null) {
  return useQuery({
    queryKey: ['workshop', 'mod', modId],
    queryFn: () => api.get<WorkshopModDetail>(`/api/workshop/mods/${modId}`),
    enabled: modId !== null,
    staleTime: 5 * 60_000,
  });
}

export function useUsers(enabled: boolean) {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: PanelUser[] }>('/api/users'),
    enabled,
  });
}

export function useSetUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.patch(`/api/users/${userId}/role`, { role }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}
