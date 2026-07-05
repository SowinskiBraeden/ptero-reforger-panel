import type {
  RestartScheduleInput,
  ServerScheduleSummary,
  ServerScheduleTask,
  ServerStatus,
} from '@reforger-panel/shared';
import { ApiError } from '../../lib/errors.js';
import type {
  DownloadableFile,
  GameServerProvider,
  ProviderServerResources,
  ServerFileEntry,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;

type PterodactylOptions = {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type PterodactylScheduleResponse = {
  data?: {
    attributes?: PterodactylScheduleAttributes;
  };
};

type PterodactylScheduleAttributes = {
  id?: number | string;
  name?: string;
  cron?: {
    minute?: string;
    hour?: string;
    day_of_month?: string;
    month?: string;
    day_of_week?: string;
  };
  is_active?: boolean;
  only_when_online?: boolean;
  last_run_at?: string | null;
  next_run_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  relationships?: {
    tasks?: {
      data?: {
        attributes?: {
          id?: number | string;
          action?: string;
          payload?: string;
          time_offset?: number;
          continue_on_failure?: boolean;
        };
      }[];
    };
  };
};

function mapState(state: string): ServerStatus {
  switch (state) {
    case 'running':
      return 'online';
    case 'offline':
      return 'offline';
    case 'starting':
      return 'starting';
    case 'stopping':
      return 'stopping';
    default:
      return 'unknown';
  }
}

/**
 * Pterodactyl Client API provider. Uses only client-scoped endpoints (status,
 * resources, power, read-only file access). Errors are sanitized: they carry
 * the endpoint category and HTTP status, never the API key or full URL.
 */
export class PterodactylProvider implements GameServerProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private limitsCache = new Map<
    string,
    {
      cpuLimitPercent: number | null;
      memoryLimitBytes: number | null;
      diskLimitBytes: number | null;
      fetchedAt: number;
    }
  >();

  constructor(options: PterodactylOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request<T = unknown>(
    label: string,
    path: string,
    init: { method?: string; body?: unknown; timeoutMs?: number; raw?: boolean } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}/api/client${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(init.timeoutMs ?? this.timeoutMs),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'failed';
      throw ApiError.upstream(`Pterodactyl request (${label}) ${reason}.`);
    }
    if (!response.ok) {
      throw ApiError.upstream(`Pterodactyl request (${label}) returned HTTP ${response.status}.`);
    }
    if (init.raw) {
      return (await response.text()) as T;
    }
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw ApiError.upstream(`Pterodactyl request (${label}) returned invalid JSON.`);
    }
  }

  private async getLimits(serverId: string) {
    const cached = this.limitsCache.get(serverId);
    if (cached && Date.now() - cached.fetchedAt < 5 * 60_000) return cached;
    const data = await this.request<{
      attributes?: { limits?: { cpu?: number; memory?: number; disk?: number } };
    }>('server details', `/servers/${encodeURIComponent(serverId)}`);
    const limits = data.attributes?.limits;
    const entry = {
      cpuLimitPercent: limits?.cpu && limits.cpu > 0 ? limits.cpu : null,
      memoryLimitBytes: limits?.memory ? limits.memory * 1024 * 1024 : null,
      diskLimitBytes: limits?.disk ? limits.disk * 1024 * 1024 : null,
      fetchedAt: Date.now(),
    };
    this.limitsCache.set(serverId, entry);
    return entry;
  }

  async getServerStatus(serverId: string): Promise<ServerStatus> {
    const resources = await this.getServerResources(serverId);
    return resources.status;
  }

  async getServerResources(serverId: string): Promise<ProviderServerResources> {
    const data = await this.request<{
      attributes?: {
        current_state?: string;
        resources?: {
          memory_bytes?: number;
          cpu_absolute?: number;
          disk_bytes?: number;
          network_rx_bytes?: number;
          network_tx_bytes?: number;
          uptime?: number;
        };
      };
    }>('resources', `/servers/${encodeURIComponent(serverId)}/resources`);

    const attrs = data.attributes ?? {};
    const res = attrs.resources ?? {};
    const limits = await this.getLimits(serverId).catch(() => ({
      cpuLimitPercent: null,
      memoryLimitBytes: null,
      diskLimitBytes: null,
    }));

    return {
      status: mapState(attrs.current_state ?? 'unknown'),
      cpuPercent: res.cpu_absolute ?? 0,
      cpuLimitPercent: limits.cpuLimitPercent,
      memoryBytes: res.memory_bytes ?? 0,
      memoryLimitBytes: limits.memoryLimitBytes,
      diskBytes: res.disk_bytes ?? 0,
      diskLimitBytes: limits.diskLimitBytes,
      networkRxBytes: res.network_rx_bytes ?? 0,
      networkTxBytes: res.network_tx_bytes ?? 0,
      uptimeMs: res.uptime ?? 0,
    };
  }

  private async sendPowerSignal(serverId: string, signal: 'start' | 'stop' | 'restart') {
    await this.request(`power ${signal}`, `/servers/${encodeURIComponent(serverId)}/power`, {
      method: 'POST',
      body: { signal },
    });
  }

  async startServer(serverId: string): Promise<void> {
    await this.sendPowerSignal(serverId, 'start');
  }

  async stopServer(serverId: string): Promise<void> {
    await this.sendPowerSignal(serverId, 'stop');
  }

  async restartServer(serverId: string): Promise<void> {
    await this.sendPowerSignal(serverId, 'restart');
  }

  async listFiles(serverId: string, directory: string): Promise<ServerFileEntry[]> {
    const data = await this.request<{
      data?: {
        attributes?: {
          name?: string;
          is_file?: boolean;
          size?: number;
          modified_at?: string;
        };
      }[];
    }>(
      'file list',
      `/servers/${encodeURIComponent(serverId)}/files/list?directory=${encodeURIComponent(directory)}`,
    );
    return (data.data ?? []).map((entry) => ({
      name: entry.attributes?.name ?? '',
      isFile: entry.attributes?.is_file ?? false,
      sizeBytes: entry.attributes?.size ?? 0,
      modifiedAt: entry.attributes?.modified_at ? new Date(entry.attributes.modified_at) : null,
    }));
  }

  async getFileDownloadUrl(serverId: string, path: string): Promise<string> {
    const data = await this.request<{ attributes?: { url?: string } }>(
      'file download url',
      `/servers/${encodeURIComponent(serverId)}/files/download?file=${encodeURIComponent(path)}`,
    );
    const url = data.attributes?.url;
    if (!url) {
      throw ApiError.upstream('Pterodactyl did not return a download URL.');
    }
    return url;
  }

  /**
   * Downloads a text file via the signed one-time download URL (streams and
   * caps size, unlike files/contents which buffers whole files). When the file
   * exceeds maxBytes the TAIL is kept — this method exists for log retrieval.
   */
  async downloadTextFile(
    serverId: string,
    path: string,
    maxBytes: number = DEFAULT_MAX_DOWNLOAD_BYTES,
  ): Promise<DownloadableFile> {
    const stat = await this.statFile(serverId, path);
    const url = await this.getFileDownloadUrl(serverId, path);
    let response: Response;
    try {
      response = await this.fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'failed';
      throw ApiError.upstream(`Pterodactyl log download ${reason}.`);
    }
    if (!response.ok || !response.body) {
      throw ApiError.upstream(`Pterodactyl log download returned HTTP ${response.status}.`);
    }

    // Stream and keep a rolling tail of at most maxBytes.
    const chunks: Uint8Array[] = [];
    let buffered = 0;
    let discarded = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      buffered += value.byteLength;
      while (buffered - (chunks[0]?.byteLength ?? 0) >= maxBytes && chunks.length > 1) {
        const dropped = chunks.shift()!;
        buffered -= dropped.byteLength;
        discarded += dropped.byteLength;
      }
    }
    let combined = Buffer.concat(chunks);
    if (combined.byteLength > maxBytes) {
      const trim = combined.byteLength - maxBytes;
      combined = combined.subarray(trim);
      discarded += trim;
    }

    return {
      path,
      content: combined.toString('utf8'),
      totalSizeBytes: stat?.sizeBytes ?? discarded + combined.byteLength,
      contentStartOffset: discarded,
      truncated: discarded > 0,
    };
  }

  async writeTextFile(serverId: string, path: string, content: string): Promise<void> {
    const url = `${this.baseUrl}/api/client/servers/${encodeURIComponent(serverId)}/files/write?file=${encodeURIComponent(path)}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'text/plain',
        },
        body: content,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'failed';
      throw ApiError.upstream(`Pterodactyl request (file write) ${reason}.`);
    }
    if (!response.ok) {
      throw ApiError.upstream(`Pterodactyl request (file write) returned HTTP ${response.status}.`);
    }
  }

  async listStartupVariables(serverId: string) {
    const data = await this.request<{
      data?: {
        attributes?: {
          name?: string;
          description?: string;
          env_variable?: string;
          server_value?: string | null;
          default_value?: string | null;
          is_editable?: boolean;
        };
      }[];
    }>('startup variables', `/servers/${encodeURIComponent(serverId)}/startup`);
    return (data.data ?? []).map((entry) => ({
      name: entry.attributes?.name ?? '',
      description: entry.attributes?.description ?? '',
      envVariable: entry.attributes?.env_variable ?? '',
      serverValue: entry.attributes?.server_value ?? '',
      defaultValue: entry.attributes?.default_value ?? '',
      isEditable: entry.attributes?.is_editable ?? false,
    }));
  }

  async updateStartupVariable(serverId: string, envVariable: string, value: string): Promise<void> {
    await this.request(
      'startup variable update',
      `/servers/${encodeURIComponent(serverId)}/startup/variable`,
      { method: 'PUT', body: { key: envVariable, value } },
    );
  }

  private mapSchedule(attributes: PterodactylScheduleAttributes): ServerScheduleSummary {
    const cron = attributes.cron ?? {};
    const tasks: ServerScheduleTask[] = (attributes.relationships?.tasks?.data ?? []).map(
      (task) => ({
        id: String(task.attributes?.id ?? ''),
        action: task.attributes?.action ?? '',
        payload: task.attributes?.payload ?? '',
        timeOffsetSeconds: task.attributes?.time_offset ?? 0,
        continueOnFailure: task.attributes?.continue_on_failure ?? false,
      }),
    );
    return {
      id: String(attributes.id ?? ''),
      name: attributes.name ?? 'Untitled schedule',
      isActive: attributes.is_active ?? false,
      onlyWhenOnline: attributes.only_when_online ?? false,
      minute: cron.minute ?? '*',
      hour: cron.hour ?? '*',
      dayOfMonth: cron.day_of_month ?? '*',
      month: cron.month ?? '*',
      dayOfWeek: cron.day_of_week ?? '*',
      nextRunAt: attributes.next_run_at ?? null,
      lastRunAt: attributes.last_run_at ?? null,
      createdAt: attributes.created_at ?? null,
      updatedAt: attributes.updated_at ?? null,
      tasks,
    };
  }

  private scheduleBody(input: RestartScheduleInput) {
    return {
      name: input.name,
      is_active: input.isActive,
      minute: String(input.minute),
      hour: String(input.hour),
      day_of_month: '*',
      month: '*',
      day_of_week: input.dayOfWeek,
      only_when_online: input.onlyWhenOnline,
    };
  }

  async listSchedules(serverId: string): Promise<ServerScheduleSummary[]> {
    const data = await this.request<{
      data?: { attributes?: PterodactylScheduleAttributes }[];
    }>('schedules', `/servers/${encodeURIComponent(serverId)}/schedules?include=tasks`);
    return (data.data ?? []).map((entry) => this.mapSchedule(entry.attributes ?? {}));
  }

  async createRestartSchedule(
    serverId: string,
    input: RestartScheduleInput,
  ): Promise<ServerScheduleSummary> {
    const created = await this.request<PterodactylScheduleResponse>(
      'schedule create',
      `/servers/${encodeURIComponent(serverId)}/schedules`,
      { method: 'POST', body: this.scheduleBody(input) },
    );
    const schedule = this.mapSchedule(created.data?.attributes ?? {});
    if (!schedule.id) {
      throw ApiError.upstream('Pterodactyl did not return the created schedule id.');
    }
    await this.request(
      'schedule task create',
      `/servers/${encodeURIComponent(serverId)}/schedules/${encodeURIComponent(schedule.id)}/tasks`,
      {
        method: 'POST',
        body: {
          action: 'power',
          payload: 'restart',
          time_offset: 0,
          continue_on_failure: false,
        },
      },
    );
    const [withTasks] = (await this.listSchedules(serverId)).filter((s) => s.id === schedule.id);
    return withTasks ?? schedule;
  }

  async updateRestartSchedule(
    serverId: string,
    scheduleId: string,
    input: RestartScheduleInput,
  ): Promise<ServerScheduleSummary> {
    const updated = await this.request<PterodactylScheduleResponse>(
      'schedule update',
      `/servers/${encodeURIComponent(serverId)}/schedules/${encodeURIComponent(scheduleId)}`,
      { method: 'PATCH', body: this.scheduleBody(input) },
    );
    return this.mapSchedule(updated.data?.attributes ?? {});
  }

  async deleteSchedule(serverId: string, scheduleId: string): Promise<void> {
    await this.request(
      'schedule delete',
      `/servers/${encodeURIComponent(serverId)}/schedules/${encodeURIComponent(scheduleId)}`,
      { method: 'DELETE' },
    );
  }

  private async statFile(
    serverId: string,
    path: string,
  ): Promise<{ sizeBytes: number; modifiedAt: Date | null } | null> {
    const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) || '/' : '/';
    const fileName = path.slice(path.lastIndexOf('/') + 1);
    try {
      const entries = await this.listFiles(serverId, directory);
      const match = entries.find((entry) => entry.isFile && entry.name === fileName);
      return match ? { sizeBytes: match.sizeBytes, modifiedAt: match.modifiedAt } : null;
    } catch {
      return null;
    }
  }
}
