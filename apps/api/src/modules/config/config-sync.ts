import type { ReforgerServerConfig } from '@reforger-panel/shared';
import { sanitizeErrorMessage, type Logger } from '../../lib/logger.js';
import type { GameServerProvider } from '../pterodactyl/types.js';
import type { ServerRecord, ServerService } from '../servers/server-service.js';
import { parseReforgerConfigJson } from './reforger-config-file.js';

const CONFIG_MAX_BYTES = 256 * 1024;

export type ConfigSyncResult = {
  serverName: string;
  maxPlayers: number;
  config: ReforgerServerConfig;
};

/**
 * Reads the server's real config.json (via the provider, read-only) and keeps
 * the server row's name/maxPlayers in line with what the server actually
 * runs. Configuration is always served live; no revision history is kept.
 */
export class ConfigSyncService {
  constructor(
    private readonly provider: GameServerProvider,
    private readonly servers: ServerService,
    private readonly logger: Logger,
    private readonly configPath: string,
  ) {}

  async getLiveConfig(server: ServerRecord): Promise<ReforgerServerConfig> {
    const providerServerId = server.pterodactylServerId ?? server.slug;
    const file = await this.provider.downloadTextFile(
      providerServerId,
      this.configPath,
      CONFIG_MAX_BYTES,
    );
    return parseReforgerConfigJson(file.content);
  }

  async sync(server: ServerRecord): Promise<ConfigSyncResult> {
    const config = await this.getLiveConfig(server);
    const maxPlayers = config.maxPlayers > 0 ? config.maxPlayers : null;
    if (server.name !== config.serverName || server.maxPlayers !== maxPlayers) {
      await this.servers.updateServerInfo(server.id, {
        name: config.serverName,
        maxPlayers,
      });
      this.logger.info(
        { serverId: server.id, serverName: config.serverName, maxPlayers },
        'server info updated from config.json',
      );
    }
    return { serverName: config.serverName, maxPlayers: config.maxPlayers, config };
  }

  /** Sync all servers, logging failures instead of throwing (for the poll loop). */
  async syncAllQuietly(): Promise<void> {
    const servers = await this.servers.listServers();
    for (const server of servers) {
      try {
        await this.sync(server);
      } catch (error) {
        this.logger.warn(
          { serverId: server.id, error: sanitizeErrorMessage(error) },
          'config sync failed',
        );
      }
    }
  }
}
