import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActivityItem,
  ConfigPatchOp,
  ConfigPatchResult,
  ConfigRawResponse,
  ConfigTreeResponse,
  ConfigurationResponse,
  ConsoleBacklog,
  ConsoleLine,
  CurrentUser,
  InviteSummary,
  KillfeedEvent,
  KnownPlayer,
  LogIngestionHealth,
  LogSyncResult,
  MissionsResponse,
  ModPackSummary,
  ModResolveResponse,
  ModsOverviewResponse,
  PanelUser,
  PerformanceSettingsPatch,
  PerformanceSettingsResponse,
  PlayersResponse,
  RawLogsResponse,
  ReforgerConfigMod,
  ResourceHistoryResponse,
  RestartScheduleInput,
  ServerModsResponse,
  ServerResources,
  ServerScheduleSummary,
  ServerStatus,
  ServerSummary,
  StartupResponse,
  UpdateModsResult,
  WorkshopModDetail,
  WorkshopModVersionsResponse,
  WorkshopSearchResponse,
  WorkshopServerModsResponse,
  WorkshopServerSearchResponse,
} from '@reforger-panel/shared';
import { api, ApiClientError } from './client.js';

/* -------------------------------------------------------------------- auth */

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

/* ----------------------------------------------------------------- servers */

export function useServers() {
  return useQuery({
    queryKey: ['servers'],
    queryFn: () => api.get<{ servers: ServerSummary[] }>('/api/servers'),
    refetchInterval: 15_000,
  });
}

/** The panel manages one server; every page derives its slug from here. */
export function usePrimaryServer(): ServerSummary | undefined {
  return useServers().data?.servers[0];
}

export function useServerResources(slug: string, enabled = true) {
  return useQuery({
    queryKey: ['servers', slug, 'resources'],
    queryFn: () => api.get<ServerResources>(`/api/servers/${slug}/resources`),
    // Backed by the websocket stats frame server-side, so this is a cheap
    // in-memory read rather than an upstream request.
    refetchInterval: 5_000,
    enabled,
  });
}

export function useResourceHistory(slug: string) {
  return useQuery({
    queryKey: ['servers', slug, 'resources', 'history'],
    queryFn: () => api.get<ResourceHistoryResponse>(`/api/servers/${slug}/resources/history`),
    refetchInterval: 15_000,
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

/* ----------------------------------------------------------------- players */

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

/* ----------------------------------------------------------- configuration */

export function useConfiguration(slug: string) {
  return useQuery({
    queryKey: ['servers', slug, 'configuration'],
    queryFn: () => api.get<ConfigurationResponse>(`/api/servers/${slug}/configuration`),
    // Live download from the game server on each fetch — keep it calm.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function usePerformanceSettings(slug: string) {
  return useQuery({
    queryKey: ['servers', slug, 'config', 'performance'],
    queryFn: () => api.get<PerformanceSettingsResponse>(`/api/servers/${slug}/config/performance`),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export type PerformanceSavePayload = {
  settings: PerformanceSettingsPatch;
  expectedRevision?: string;
  writeStartupVars?: boolean;
};

export function useSetPerformanceSettings(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PerformanceSavePayload) =>
      api.put<PerformanceSettingsResponse & { changedFields: string[]; requiresRestart: boolean }>(
        `/api/servers/${slug}/config/performance`,
        payload,
      ),
    onSuccess: () => {
      // config.json moved: every view derived from it is now stale.
      void queryClient.invalidateQueries({ queryKey: ['servers', slug] });
    },
  });
}

/** Every key present in config.json, for the searchable editor. */
export function useConfigTree(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: ['servers', slug, 'config', 'tree'],
    queryFn: () => api.get<ConfigTreeResponse>(`/api/servers/${slug}/config/tree`),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function usePatchConfig(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      ops: ConfigPatchOp[];
      expectedRevision?: string;
      writeStartupVars?: boolean;
    }) => api.patch<ConfigPatchResult>(`/api/servers/${slug}/config`, payload),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['servers', slug] }),
  });
}

export function useConfigRaw(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: ['servers', slug, 'config', 'raw'],
    queryFn: () => api.get<ConfigRawResponse>(`/api/servers/${slug}/config/raw`),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function usePutConfigRaw(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { content: string; expectedRevision?: string }) =>
      api.put<ConfigRawResponse>(`/api/servers/${slug}/config/raw`, payload),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['servers', slug] }),
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

/* ---------------------------------------------------------------- missions */

export function useMissions(slug: string) {
  return useQuery({
    queryKey: ['servers', slug, 'missions'],
    queryFn: () => api.get<MissionsResponse>(`/api/servers/${slug}/missions`),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/* -------------------------------------------------------------------- mods */

export function useServerMods(slug: string) {
  return useQuery({
    queryKey: ['servers', slug, 'mods'],
    queryFn: () => api.get<ServerModsResponse>(`/api/servers/${slug}/mods`),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * The whole Mods page in one request. While the server-side Workshop cache is
 * still filling (`warming`), this refetches shortly so metadata appears
 * progressively instead of blocking the first paint.
 */
export function useModsOverview(slug: string) {
  return useQuery({
    queryKey: ['servers', slug, 'mods', 'overview'],
    queryFn: () => api.get<ModsOverviewResponse>(`/api/servers/${slug}/mods/overview`),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (query.state.data?.warming ? 3_000 : false),
  });
}

export function useResolveMods(slug: string) {
  return useMutation({
    mutationFn: (mods: ReforgerConfigMod[]) =>
      api.post<ModResolveResponse>(`/api/servers/${slug}/mods/resolve`, { mods }),
  });
}

export function useSetServerMods(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { mods: ReforgerConfigMod[]; expectedRevision?: string }) =>
      api.put<UpdateModsResult>(`/api/servers/${slug}/mods`, payload),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['servers', slug] }),
  });
}

export function useModPacks(slug: string) {
  return useQuery({
    queryKey: ['servers', slug, 'mod-packs'],
    queryFn: () => api.get<{ modPacks: ModPackSummary[] }>(`/api/servers/${slug}/mod-packs`),
  });
}

/* ---------------------------------------------------------------- workshop */

export type WorkshopSearchParams = {
  query: string;
  page: number;
  sort?: string;
  tag?: string;
  category?: string;
};

export function useWorkshopSearch(params: WorkshopSearchParams, enabled = true) {
  const search = new URLSearchParams({ q: params.query, page: String(params.page) });
  if (params.sort) search.set('sort', params.sort);
  if (params.tag) search.set('tag', params.tag);
  if (params.category) search.set('category', params.category);
  return useQuery({
    queryKey: ['workshop', 'search', params],
    queryFn: () => api.get<WorkshopSearchResponse>(`/api/workshop/search?${search}`),
    enabled,
    placeholderData: (previous) => previous,
    staleTime: 5 * 60_000,
  });
}

export function useWorkshopMod(modId: string | null) {
  return useQuery({
    queryKey: ['workshop', 'mod', modId],
    queryFn: () => api.get<WorkshopModDetail>(`/api/workshop/mods/${modId}`),
    enabled: modId !== null,
    staleTime: 30 * 60_000,
  });
}

export function useWorkshopModVersions(modId: string | null) {
  return useQuery({
    queryKey: ['workshop', 'mod', modId, 'versions'],
    queryFn: () => api.get<WorkshopModVersionsResponse>(`/api/workshop/mods/${modId}/versions`),
    enabled: modId !== null,
    staleTime: 30 * 60_000,
  });
}

/** Live server browser, used to copy another server's modlist. */
export function useWorkshopServers(query: string, enabled: boolean) {
  return useQuery({
    queryKey: ['workshop', 'servers', query],
    queryFn: () =>
      api.get<WorkshopServerSearchResponse>(`/api/workshop/servers?q=${encodeURIComponent(query)}`),
    enabled: enabled && query.trim().length >= 2,
    staleTime: 60_000,
  });
}

export function useWorkshopServerMods(serverId: string | null) {
  return useQuery({
    queryKey: ['workshop', 'servers', serverId, 'mods'],
    queryFn: () => api.get<WorkshopServerModsResponse>(`/api/workshop/servers/${serverId}/mods`),
    enabled: serverId !== null,
    staleTime: 60_000,
  });
}

/* ------------------------------------------------------------ live console */

const MAX_CONSOLE_LINES = 2_000;

export type ConsoleFeed = {
  lines: ConsoleLine[];
  status: ServerStatus;
  connected: boolean;
  stats: ServerResources | null;
  clear: () => void;
};

/**
 * Subscribes to the panel's SSE relay of the Pterodactyl/Wings feed.
 *
 * Because the backend keeps its own line backlog, attaching mid-session
 * immediately yields recent context — including install, update and mod
 * download output, which never reaches the game's own log file.
 */
export function useConsoleFeed(slug: string, enabled: boolean): ConsoleFeed {
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [status, setStatus] = useState<ServerStatus>('unknown');
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState<ServerResources | null>(null);
  const lastSeq = useRef(0);

  useEffect(() => {
    if (!enabled || !slug) return;
    const source = new EventSource(`/api/servers/${slug}/console/stream`, {
      withCredentials: true,
    });

    const append = (incoming: ConsoleLine[]) => {
      const fresh = incoming.filter((line) => line.seq > lastSeq.current);
      if (fresh.length === 0) return;
      lastSeq.current = fresh[fresh.length - 1]!.seq;
      setLines((current) => {
        const next = [...current, ...fresh];
        return next.length > MAX_CONSOLE_LINES ? next.slice(next.length - MAX_CONSOLE_LINES) : next;
      });
    };

    const parse = <T>(event: MessageEvent<string>): T | null => {
      try {
        return JSON.parse(event.data) as T;
      } catch {
        return null;
      }
    };

    source.addEventListener('backlog', (event) => {
      const backlog = parse<ConsoleBacklog>(event as MessageEvent<string>);
      if (!backlog) return;
      // A reconnect replays the backlog; seq numbers keep it idempotent.
      append(backlog.lines);
      setStatus(backlog.status);
      setConnected(backlog.connected);
    });

    source.addEventListener('line', (event) => {
      const line = parse<ConsoleLine>(event as MessageEvent<string>);
      if (line) append([line]);
    });

    source.addEventListener('status', (event) => {
      const payload = parse<{ status: ServerStatus }>(event as MessageEvent<string>);
      if (payload) setStatus(payload.status);
    });

    source.addEventListener('stats', (event) => {
      const payload = parse<ServerResources>(event as MessageEvent<string>);
      if (payload) setStats(payload);
    });

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    return () => source.close();
  }, [slug, enabled]);

  return {
    lines,
    status,
    connected,
    stats,
    clear: () => setLines([]),
  };
}

/** The game's own log file, as a secondary diagnostic to the live feed. */
export function useRawLogs(slug: string, lines: number, enabled: boolean) {
  return useQuery({
    queryKey: ['servers', slug, 'logs', 'raw', lines],
    queryFn: () => api.get<RawLogsResponse>(`/api/servers/${slug}/logs/raw?lines=${lines}`),
    enabled,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

/* ----------------------------------------------------------- log ingestion */

export function useLogHealth(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: ['servers', slug, 'logs', 'health'],
    queryFn: () => api.get<LogIngestionHealth>(`/api/servers/${slug}/logs/health`),
    refetchInterval: 30_000,
    enabled,
  });
}

export function useManualLogSync(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<LogSyncResult>(`/api/servers/${slug}/logs/sync`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['servers', slug] }),
  });
}

/* --------------------------------------------------------------- schedules */

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

/* --------------------------------------------------------- users & invites */

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
