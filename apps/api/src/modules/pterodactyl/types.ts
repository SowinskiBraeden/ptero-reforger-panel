import type {
  RestartScheduleInput,
  ServerScheduleSummary,
  ServerStatus,
} from '@reforger-panel/shared';

export type ProviderServerResources = {
  status: ServerStatus;
  cpuPercent: number;
  cpuLimitPercent: number | null;
  memoryBytes: number;
  memoryLimitBytes: number | null;
  diskBytes: number;
  diskLimitBytes: number | null;
  networkRxBytes: number;
  networkTxBytes: number;
  uptimeMs: number;
};

export type ServerFileEntry = {
  name: string;
  isFile: boolean;
  sizeBytes: number;
  modifiedAt: Date | null;
};

export type DownloadableFile = {
  path: string;
  content: string;
  /** Size of the file on the remote, if known (may exceed content length when capped). */
  totalSizeBytes: number | null;
  /** Byte offset of content[0] within the remote file. Non-zero when the head was trimmed. */
  contentStartOffset: number;
  truncated: boolean;
};

/**
 * Abstraction over the game-server backend (Pterodactyl Client API in
 * production, an in-process mock for local development). Deliberately narrow:
 * no arbitrary writes, no console execution.
 */
export interface GameServerProvider {
  getServerStatus(serverId: string): Promise<ServerStatus>;
  getServerResources(serverId: string): Promise<ProviderServerResources>;

  startServer(serverId: string): Promise<void>;
  stopServer(serverId: string): Promise<void>;
  restartServer(serverId: string): Promise<void>;

  listFiles(serverId: string, directory: string): Promise<ServerFileEntry[]>;
  getFileDownloadUrl(serverId: string, path: string): Promise<string>;
  downloadTextFile(serverId: string, path: string, maxBytes?: number): Promise<DownloadableFile>;

  /**
   * Writes a text file. NOT exposed as a generic panel endpoint: the only
   * callers write server-generated content to paths from server configuration
   * (config.json updates and their backups), never user-supplied paths.
   */
  writeTextFile(serverId: string, path: string, content: string): Promise<void>;

  /** Egg startup variables (Pterodactyl "Startup" tab). May contain secrets. */
  listStartupVariables(serverId: string): Promise<StartupVariableEntry[]>;
  updateStartupVariable(serverId: string, envVariable: string, value: string): Promise<void>;

  /** Native Pterodactyl schedules, scoped here to restart schedule management. */
  listSchedules(serverId: string): Promise<ServerScheduleSummary[]>;
  createRestartSchedule(
    serverId: string,
    input: RestartScheduleInput,
  ): Promise<ServerScheduleSummary>;
  updateRestartSchedule(
    serverId: string,
    scheduleId: string,
    input: RestartScheduleInput,
  ): Promise<ServerScheduleSummary>;
  deleteSchedule(serverId: string, scheduleId: string): Promise<void>;
}

export type StartupVariableEntry = {
  name: string;
  description: string;
  envVariable: string;
  serverValue: string;
  defaultValue: string;
  isEditable: boolean;
};
