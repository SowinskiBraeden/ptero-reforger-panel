import type {
  ConfigPatchOp,
  PerformanceSettings,
  PerformanceSettingsPatch,
  PerformanceSettingsResponse,
} from '@reforger-panel/shared';
import type { Logger } from '../../lib/logger.js';
import type { ServerRecord } from '../servers/server-service.js';
import type { ConfigEditorService } from './config-editor-service.js';
import type { ConfigFileGateway } from './config-file-gateway.js';
import { readAtPath } from './config-tree.js';

/** Where each curated performance field lives inside config.json. */
export const PERFORMANCE_FIELD_PATHS: Record<keyof PerformanceSettings, string> = {
  scenarioId: 'game.scenarioId',
  maxPlayers: 'game.maxPlayers',
  serverMaxViewDistance: 'game.gameProperties.serverMaxViewDistance',
  networkViewDistance: 'game.gameProperties.networkViewDistance',
  serverMinGrassDistance: 'game.gameProperties.serverMinGrassDistance',
  disableThirdPerson: 'game.gameProperties.disableThirdPerson',
  fastValidation: 'game.gameProperties.fastValidation',
  battlEye: 'game.gameProperties.battlEye',
  disableAI: 'operating.disableAI',
  aiLimit: 'operating.aiLimit',
  playerSaveTime: 'operating.playerSaveTime',
  slotReservationTimeout: 'operating.slotReservationTimeout',
  lobbyPlayerSynchronise: 'operating.lobbyPlayerSynchronise',
};

const PERFORMANCE_FIELDS = Object.keys(PERFORMANCE_FIELD_PATHS) as (keyof PerformanceSettings)[];

export function readPerformanceSettings(root: Record<string, unknown>): PerformanceSettings {
  const result = {} as Record<keyof PerformanceSettings, string | number | boolean | null>;
  for (const field of PERFORMANCE_FIELDS) {
    const value = readAtPath(root, PERFORMANCE_FIELD_PATHS[field]);
    const expected = field === 'scenarioId' ? 'string' : ['number', 'boolean'];
    const matches =
      typeof expected === 'string' ? typeof value === expected : expected.includes(typeof value);
    result[field] = matches ? value : null;
  }
  return result as PerformanceSettings;
}

/**
 * The curated view of config.json: typed, range-validated fields for the
 * settings the panel understands well.
 *
 * It now shares the patch engine with the general key editor, so a save only
 * ever touches the fields the caller explicitly included. Previously the form
 * posted all thirteen values on every submit, which meant a form loaded before
 * somebody else's change silently reverted it.
 */
export class PerformanceSettingsService {
  constructor(
    private readonly gateway: ConfigFileGateway,
    private readonly editor: ConfigEditorService,
    private readonly logger: Logger,
  ) {}

  private providerId(server: ServerRecord): string {
    return server.pterodactylServerId ?? server.slug;
  }

  async get(server: ServerRecord): Promise<PerformanceSettingsResponse> {
    const document = await this.gateway.download(this.providerId(server));
    return {
      settings: readPerformanceSettings(document.root),
      revision: document.revision,
      fetchedAt: new Date().toISOString(),
    };
  }

  async update(
    server: ServerRecord,
    patch: PerformanceSettingsPatch,
    options: { expectedRevision?: string; writeStartupVars?: boolean } = {},
  ): Promise<PerformanceSettingsResponse & { changedFields: string[]; requiresRestart: true }> {
    const before = await this.get(server);

    // Only fields the caller actually sent, and only where the value differs.
    const ops: ConfigPatchOp[] = [];
    const changedFields: string[] = [];
    for (const field of PERFORMANCE_FIELDS) {
      if (!(field in patch)) continue;
      const next = patch[field] ?? null;
      if (before.settings[field] === next) continue;
      ops.push({ path: PERFORMANCE_FIELD_PATHS[field], value: next });
      changedFields.push(field);
    }

    if (ops.length === 0) {
      return { ...before, changedFields: [], requiresRestart: true };
    }

    const result = await this.editor.patch(server, ops, {
      expectedRevision: options.expectedRevision ?? before.revision,
      writeStartupVars: options.writeStartupVars ?? true,
    });

    this.logger.info({ serverId: server.id, changedFields }, 'performance settings updated');

    const after = await this.get(server);
    return {
      settings: after.settings,
      revision: result.revision,
      fetchedAt: result.fetchedAt,
      changedFields,
      requiresRestart: true,
    };
  }
}
