import type {
  RestartScheduleInput,
  ServerScheduleSummary,
  ServerStatus,
} from '@reforger-panel/shared';
import { ApiError } from '../../lib/errors.js';
import type {
  DownloadableFile,
  GameServerProvider,
  ProviderServerResources,
  ServerFileEntry,
} from './types.js';

const START_DELAY_MS = 4_000;
const STOP_DELAY_MS = 2_500;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function timeOfDay(date: Date): string {
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(
    date.getUTCMilliseconds(),
    3,
  )}`;
}

function dateStamp(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Builds a plausible Reforger console.log covering the last ~50 minutes:
 * server start, four connects, one disconnect. Line shapes mirror the real
 * Enfusion/BattlEye output the parser targets (see parser/patterns.ts).
 */
export function buildMockConsoleLog(now: Date = new Date()): string {
  const at = (minutesAgo: number, driftSeconds = 0) =>
    new Date(now.getTime() - minutesAgo * 60_000 + driftSeconds * 1000);

  const started = at(50);
  const lines = [
    `------------------------------------------------------------------------------------------------`,
    `Log started ${dateStamp(started)} ${timeOfDay(started).slice(0, 8)}`,
    `${timeOfDay(started)}  ENGINE       : Enfusion engine build: 1.3.0.42 (mock)`,
    `${timeOfDay(at(50, 4))}  DEFAULT      : Loading world.`,
    `${timeOfDay(at(49))}  DEFAULT      : Game successfully created.`,
    `${timeOfDay(at(48))}  NETWORK      : Server is ready to accept connections`,
    `${timeOfDay(at(44))}  DEFAULT      : BattlEye Server: 'Player #1 Braeden (10.66.4.21:50241) connected'`,
    `${timeOfDay(at(44, 2))}  DEFAULT      : BattlEye Server: 'Player #1 Braeden - GUID: 9f2ab04c11d9e0aa'`,
    `${timeOfDay(at(38))}  DEFAULT      : BattlEye Server: 'Player #2 Sable (10.66.4.30:61022) connected'`,
    `${timeOfDay(at(38, 1))}  DEFAULT      : BattlEye Server: 'Player #2 Sable - GUID: 41c7de9a5b02f311'`,
    `${timeOfDay(at(31))}  DEFAULT      : BattlEye Server: 'Player #3 Kestrel (10.66.4.87:49155) connected'`,
    `${timeOfDay(at(27))}  SCRIPT       : SCR_BaseGameMode: match state changed`,
    `${timeOfDay(at(22))}  DEFAULT      : BattlEye Server: 'Player #4 Moss (10.66.4.44:51811) connected'`,
    `${timeOfDay(at(22, 1))}  DEFAULT      : BattlEye Server: 'Player #4 Moss - GUID: c31009e2ab77d514'`,
    `${timeOfDay(at(9))}  DEFAULT      : BattlEye Server: 'Player #3 Kestrel disconnected'`,
    `${timeOfDay(at(2))}  NETWORK      : ### Connection stats`,
    '',
  ];
  return lines.join('\n');
}

/**
 * In-process stand-in for Pterodactyl so the whole panel runs without
 * credentials. Power actions transition through starting/stopping states, and
 * the mock file system serves a generated console.log fixture.
 */
export class MockGameServerProvider implements GameServerProvider {
  private status: ServerStatus = 'online';
  private startedAt = Date.now() - 50 * 60_000;
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly logContent: string;
  private readonly logPath: string;

  private readonly configPath: string;
  private configContent: string;
  private nextScheduleId = 2;
  private schedules: ServerScheduleSummary[] = [
    {
      id: '1',
      name: 'Daily restart',
      isActive: true,
      onlyWhenOnline: true,
      minute: '0',
      hour: '9',
      dayOfMonth: '*',
      month: '*',
      dayOfWeek: '*',
      nextRunAt: null,
      lastRunAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tasks: [
        {
          id: '1',
          action: 'power',
          payload: 'restart',
          timeOffsetSeconds: 0,
          continueOnFailure: false,
        },
      ],
    },
  ];
  /** Files written via writeTextFile (e.g. config.json backups). */
  readonly writtenFiles = new Map<string, string>();

  constructor(options: { logPath?: string; configPath?: string; now?: Date } = {}) {
    this.logPath = options.logPath ?? '/profile/logs/console.log';
    this.logContent = buildMockConsoleLog(options.now ?? new Date());
    this.configPath = options.configPath ?? '/config.json';
    // Shape mirrors a real Reforger dedicated-server config.json.
    this.configContent = JSON.stringify(
      {
        bindAddress: '0.0.0.0',
        bindPort: 2001,
        game: {
          name: 'Mock Reforger Server',
          scenarioId: '{FDE33AFE2ED7875B}Missions/23_Campaign_Montignac.conf',
          maxPlayers: 16,
          crossPlatform: true,
          gameProperties: {
            serverMaxViewDistance: 2500,
            networkViewDistance: 1500,
            disableThirdPerson: false,
          },
          mods: [{ modId: '591AF5BDA9F7CE8B', name: 'Mock Sample Mod', version: '1.0.2' }],
        },
        operating: { aiLimit: 40 },
      },
      null,
      2,
    );
  }

  dispose() {
    if (this.transitionTimer) clearTimeout(this.transitionTimer);
  }

  private transition(to: ServerStatus, after: number, thenTo: ServerStatus) {
    this.status = to;
    if (this.transitionTimer) clearTimeout(this.transitionTimer);
    this.transitionTimer = setTimeout(() => {
      this.status = thenTo;
      if (thenTo === 'online') this.startedAt = Date.now();
      this.transitionTimer = null;
    }, after);
    this.transitionTimer.unref?.();
  }

  async getServerStatus(): Promise<ServerStatus> {
    return this.status;
  }

  async getServerResources(): Promise<ProviderServerResources> {
    const online = this.status === 'online';
    const wobble = (base: number, spread: number) => base + (Math.random() - 0.5) * spread;
    return {
      status: this.status,
      cpuPercent: online ? Math.max(2, wobble(38, 14)) : 0,
      cpuLimitPercent: 400,
      memoryBytes: online ? Math.round(wobble(5.1, 0.6) * 1024 ** 3) : 0,
      memoryLimitBytes: 8 * 1024 ** 3,
      diskBytes: Math.round(22.4 * 1024 ** 3),
      diskLimitBytes: 40 * 1024 ** 3,
      networkRxBytes: online ? Math.round(wobble(9.2, 1.5) * 1024 ** 2) : 0,
      networkTxBytes: online ? Math.round(wobble(26.8, 4) * 1024 ** 2) : 0,
      uptimeMs: online ? Date.now() - this.startedAt : 0,
    };
  }

  async startServer(): Promise<void> {
    if (this.status === 'online') return;
    this.transition('starting', START_DELAY_MS, 'online');
  }

  async stopServer(): Promise<void> {
    if (this.status === 'offline') return;
    this.transition('stopping', STOP_DELAY_MS, 'offline');
  }

  async restartServer(): Promise<void> {
    this.transition('stopping', STOP_DELAY_MS, 'starting');
    setTimeout(() => {
      if (this.status === 'starting') {
        this.status = 'online';
        this.startedAt = Date.now();
      }
    }, STOP_DELAY_MS + START_DELAY_MS).unref?.();
  }

  async listFiles(_serverId: string, directory: string): Promise<ServerFileEntry[]> {
    const dir = directory.replace(/\/$/, '') || '/';
    const logDir = this.logPath.slice(0, this.logPath.lastIndexOf('/')) || '/';
    if (dir !== logDir) return [];
    return [
      {
        name: this.logPath.slice(this.logPath.lastIndexOf('/') + 1),
        isFile: true,
        sizeBytes: Buffer.byteLength(this.logContent),
        modifiedAt: new Date(),
      },
    ];
  }

  async getFileDownloadUrl(): Promise<string> {
    throw ApiError.notConfigured('Direct downloads are not available in mock mode.');
  }

  async writeTextFile(_serverId: string, path: string, content: string): Promise<void> {
    this.writtenFiles.set(path, content);
    if (path === this.configPath) {
      this.configContent = content;
    }
  }

  private startupVariables = [
    {
      name: 'Server Password',
      description: 'Password required to join the server.',
      envVariable: 'SERVER_PASSWORD',
      serverValue: '',
      defaultValue: '',
      isEditable: true,
    },
    {
      name: 'Admin Password',
      description: 'Password for in-game admin access.',
      envVariable: 'ADMIN_PASSWORD',
      serverValue: 'mock-admin-pass',
      defaultValue: '',
      isEditable: true,
    },
    {
      name: 'App ID',
      description: 'Steam application id (managed by the egg).',
      envVariable: 'SRCDS_APPID',
      serverValue: '1874900',
      defaultValue: '1874900',
      isEditable: false,
    },
  ];

  async listStartupVariables() {
    return this.startupVariables.map((v) => ({ ...v }));
  }

  async updateStartupVariable(_serverId: string, envVariable: string, value: string) {
    const variable = this.startupVariables.find((v) => v.envVariable === envVariable);
    if (!variable || !variable.isEditable) {
      throw ApiError.validation('This startup variable cannot be edited.');
    }
    variable.serverValue = value;
  }

  async listSchedules(): Promise<ServerScheduleSummary[]> {
    return this.schedules.map((schedule) => ({
      ...schedule,
      tasks: schedule.tasks.map((task) => ({ ...task })),
    }));
  }

  async createRestartSchedule(
    _serverId: string,
    input: RestartScheduleInput,
  ): Promise<ServerScheduleSummary> {
    const now = new Date().toISOString();
    const schedule: ServerScheduleSummary = {
      id: String(this.nextScheduleId++),
      name: input.name,
      isActive: input.isActive,
      onlyWhenOnline: input.onlyWhenOnline,
      minute: String(input.minute),
      hour: String(input.hour),
      dayOfMonth: '*',
      month: '*',
      dayOfWeek: input.dayOfWeek,
      nextRunAt: null,
      lastRunAt: null,
      createdAt: now,
      updatedAt: now,
      tasks: [
        {
          id: String(this.nextScheduleId++),
          action: 'power',
          payload: 'restart',
          timeOffsetSeconds: 0,
          continueOnFailure: false,
        },
      ],
    };
    this.schedules.unshift(schedule);
    return { ...schedule, tasks: schedule.tasks.map((task) => ({ ...task })) };
  }

  async updateRestartSchedule(
    _serverId: string,
    scheduleId: string,
    input: RestartScheduleInput,
  ): Promise<ServerScheduleSummary> {
    const schedule = this.schedules.find((s) => s.id === scheduleId);
    if (!schedule) throw ApiError.notFound('Schedule not found.');
    schedule.name = input.name;
    schedule.isActive = input.isActive;
    schedule.onlyWhenOnline = input.onlyWhenOnline;
    schedule.minute = String(input.minute);
    schedule.hour = String(input.hour);
    schedule.dayOfWeek = input.dayOfWeek;
    schedule.updatedAt = new Date().toISOString();
    return { ...schedule, tasks: schedule.tasks.map((task) => ({ ...task })) };
  }

  async deleteSchedule(_serverId: string, scheduleId: string): Promise<void> {
    this.schedules = this.schedules.filter((schedule) => schedule.id !== scheduleId);
  }

  async downloadTextFile(
    _serverId: string,
    path: string,
    maxBytes = 2 * 1024 * 1024,
  ): Promise<DownloadableFile> {
    const content =
      path === this.logPath
        ? this.logContent
        : path === this.configPath
          ? this.configContent
          : null;
    if (content === null) {
      throw ApiError.notFound(`Mock file not found: ${path}`);
    }
    const buffer = Buffer.from(content, 'utf8');
    const trimmed =
      buffer.byteLength > maxBytes ? buffer.subarray(buffer.byteLength - maxBytes) : buffer;
    return {
      path,
      content: trimmed.toString('utf8'),
      totalSizeBytes: buffer.byteLength,
      contentStartOffset: buffer.byteLength - trimmed.byteLength,
      truncated: trimmed.byteLength < buffer.byteLength,
    };
  }
}
