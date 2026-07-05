import type {
  PerformanceSettings,
  PerformanceSettingsPatch,
  PerformanceSettingsResponse,
} from '@reforger-panel/shared';
import type { Logger } from '../../lib/logger.js';
import type { ServerRecord } from '../servers/server-service.js';
import { asRecord, type ConfigFileGateway } from './config-file-gateway.js';
import type { ConfigSyncService } from './config-sync.js';

/** Where each performance field lives inside config.json. */
const FIELD_LOCATIONS: Record<
  keyof PerformanceSettings,
  ['game' | 'gameProperties' | 'operating', string]
> = {
  scenarioId: ['game', 'scenarioId'],
  maxPlayers: ['game', 'maxPlayers'],
  serverMaxViewDistance: ['gameProperties', 'serverMaxViewDistance'],
  networkViewDistance: ['gameProperties', 'networkViewDistance'],
  serverMinGrassDistance: ['gameProperties', 'serverMinGrassDistance'],
  disableThirdPerson: ['gameProperties', 'disableThirdPerson'],
  fastValidation: ['gameProperties', 'fastValidation'],
  battlEye: ['gameProperties', 'battlEye'],
  aiLimit: ['operating', 'aiLimit'],
  playerSaveTime: ['operating', 'playerSaveTime'],
  slotReservationTimeout: ['operating', 'slotReservationTimeout'],
  lobbyPlayerSynchronise: ['operating', 'lobbyPlayerSynchronise'],
};

function sectionFor(
  root: Record<string, unknown>,
  section: 'game' | 'gameProperties' | 'operating',
  createMissing: boolean,
): Record<string, unknown> | null {
  const game = asRecord(root.game)!;
  if (section === 'game') return game;
  if (section === 'gameProperties') {
    let props = asRecord(game.gameProperties);
    if (!props && createMissing) {
      props = {};
      game.gameProperties = props;
    }
    return props;
  }
  let operating = asRecord(root.operating);
  if (!operating && createMissing) {
    operating = {};
    root.operating = operating;
  }
  return operating;
}

export function readPerformanceSettings(root: Record<string, unknown>): PerformanceSettings {
  const result = {} as Record<keyof PerformanceSettings, number | boolean | string | null>;
  for (const [field, [section, key]] of Object.entries(FIELD_LOCATIONS) as [
    keyof PerformanceSettings,
    ['game' | 'gameProperties' | 'operating', string],
  ][]) {
    const container = sectionFor(root, section, false);
    const value = container?.[key];
    const validType =
      field === 'scenarioId'
        ? typeof value === 'string'
        : typeof value === 'number' || typeof value === 'boolean';
    result[field] = validType ? (value as number | boolean | string) : null;
  }
  return result as PerformanceSettings;
}

/**
 * Edits the performance-related keys of the live config.json. A `null` value
 * removes the key from the file entirely so the game's own default applies —
 * network/identity fields (bind address, ports, passwords, rcon…) are never
 * touched by this service.
 */
export class PerformanceSettingsService {
  constructor(
    private readonly gateway: ConfigFileGateway,
    private readonly configSync: ConfigSyncService,
    private readonly logger: Logger,
  ) {}

  private providerId(server: ServerRecord): string {
    return server.pterodactylServerId ?? server.slug;
  }

  async get(server: ServerRecord): Promise<PerformanceSettingsResponse> {
    const { root } = await this.gateway.download(this.providerId(server));
    return { settings: readPerformanceSettings(root), fetchedAt: new Date().toISOString() };
  }

  async update(
    server: ServerRecord,
    patch: PerformanceSettingsPatch,
  ): Promise<PerformanceSettingsResponse & { changedFields: string[]; requiresRestart: true }> {
    const providerId = this.providerId(server);
    const { raw, root } = await this.gateway.download(providerId);
    const before = readPerformanceSettings(root);

    const changedFields: string[] = [];
    for (const [field, [section, key]] of Object.entries(FIELD_LOCATIONS) as [
      keyof PerformanceSettings,
      ['game' | 'gameProperties' | 'operating', string],
    ][]) {
      if (!(field in patch)) continue; // untouched fields stay as-is
      const next = patch[field] as number | boolean | string | null;
      if (before[field] === next) continue;
      changedFields.push(field);
      if (next === null) {
        const container = sectionFor(root, section, false);
        if (container) delete container[key];
      } else {
        const container = sectionFor(root, section, true)!;
        container[key] = next;
      }
    }

    if (changedFields.length > 0) {
      await this.gateway.write(providerId, root, raw, (readBack) => {
        const after = readPerformanceSettings(readBack);
        for (const field of changedFields) {
          if (
            after[field as keyof PerformanceSettings] !== patch[field as keyof PerformanceSettings]
          ) {
            throw new Error('Config write verification failed. Check config.json.bak.');
          }
        }
      });
      await this.configSync.sync(server).catch((error) => {
        this.logger.warn(
          { serverId: server.id, err: String(error) },
          'post-write config sync failed',
        );
      });
      this.logger.info({ serverId: server.id, changedFields }, 'performance settings updated');
    }

    return {
      settings: { ...before, ...patch } as PerformanceSettings,
      fetchedAt: new Date().toISOString(),
      changedFields,
      requiresRestart: true,
    };
  }
}
