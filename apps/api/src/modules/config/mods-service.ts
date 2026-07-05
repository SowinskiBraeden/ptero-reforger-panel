import type {
  ReforgerConfigMod,
  ServerModsResponse,
  UpdateModsResult,
} from '@reforger-panel/shared';
import { ApiError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { ServerRecord } from '../servers/server-service.js';
import { asRecord, type ConfigFileGateway } from './config-file-gateway.js';
import type { ConfigSyncService } from './config-sync.js';

function readMods(root: Record<string, unknown>): ReforgerConfigMod[] {
  const game = asRecord(root.game);
  if (!game || !Array.isArray(game.mods)) return [];
  return game.mods
    .map((entry): ReforgerConfigMod | null => {
      const mod = asRecord(entry);
      const modId = typeof mod?.modId === 'string' ? mod.modId : '';
      if (!modId) return null;
      const name = typeof mod?.name === 'string' && mod.name ? mod.name : undefined;
      const version = typeof mod?.version === 'string' && mod.version ? mod.version : undefined;
      return {
        modId,
        ...(name ? { name } : {}),
        ...(version ? { version } : {}),
      };
    })
    .filter((mod): mod is ReforgerConfigMod => mod !== null);
}

/**
 * Manages the `game.mods` array of the server's real config.json through the
 * shared ConfigFileGateway (backup + read-back verification; all other config
 * fields pass through untouched). Changes apply on the next server restart.
 */
export class ServerModsService {
  constructor(
    private readonly gateway: ConfigFileGateway,
    private readonly configSync: ConfigSyncService,
    private readonly logger: Logger,
  ) {}

  private providerId(server: ServerRecord): string {
    return server.pterodactylServerId ?? server.slug;
  }

  async getMods(server: ServerRecord): Promise<ServerModsResponse> {
    const { root } = await this.gateway.download(this.providerId(server));
    return { mods: readMods(root), fetchedAt: new Date().toISOString() };
  }

  async setMods(server: ServerRecord, mods: ReforgerConfigMod[]): Promise<UpdateModsResult> {
    const providerId = this.providerId(server);
    const { raw, root } = await this.gateway.download(providerId);
    const previous = readMods(root);

    const previousIds = new Set(previous.map((mod) => mod.modId.toUpperCase()));
    const nextIds = new Set(mods.map((mod) => mod.modId.toUpperCase()));
    const added = [...nextIds].filter((id) => !previousIds.has(id)).length;
    const removed = [...previousIds].filter((id) => !nextIds.has(id)).length;

    const game = asRecord(root.game)!;
    game.mods = mods.map((mod) => ({
      modId: mod.modId.toUpperCase(),
      ...(mod.name ? { name: mod.name } : {}),
      ...(mod.version ? { version: mod.version } : {}),
    }));

    const verified = await this.gateway.write(providerId, root, raw, (readBack) => {
      const verifyIds = readMods(readBack)
        .map((mod) => mod.modId.toUpperCase())
        .sort();
      if (JSON.stringify(verifyIds) !== JSON.stringify([...nextIds].sort())) {
        throw ApiError.upstream(
          'Config write verification failed — the file on the server does not match. Check config.json.bak.',
        );
      }
    });

    await this.configSync.sync(server).catch((error) => {
      this.logger.warn(
        { serverId: server.id, err: String(error) },
        'post-write config sync failed',
      );
    });

    this.logger.info({ serverId: server.id, added, removed }, 'server mods updated');
    return {
      mods: readMods(verified),
      fetchedAt: new Date().toISOString(),
      added,
      removed,
      requiresRestart: true,
    };
  }
}
