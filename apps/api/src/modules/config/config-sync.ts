import type { ReforgerServerConfig } from '@reforger-panel/shared';
import { sanitizeErrorMessage, type Logger } from '../../lib/logger.js';
import type { ServerRecord, ServerService } from '../servers/server-service.js';
import type { ConfigFileGateway } from './config-file-gateway.js';
import { mapReforgerConfig } from './reforger-config-file.js';

export type LiveConfig = {
  config: ReforgerServerConfig;
  revision: string;
};

export type ConfigSyncResult = {
  serverName: string;
  maxPlayers: number;
  config: ReforgerServerConfig;
};

/**
 * Reads the server's real config.json and keeps the server row's
 * name/maxPlayers in line with what the server actually runs. Configuration is
 * always served live; no revision history is kept.
 *
 * Reads go through the shared gateway so they queue behind in-flight writes
 * and return the same content revision the editors use for conflict detection.
 */
export class ConfigSyncService {
  constructor(
    private readonly gateway: ConfigFileGateway,
    private readonly servers: ServerService,
    private readonly logger: Logger,
  ) {}

  private providerId(server: ServerRecord): string {
    return server.pterodactylServerId ?? server.slug;
  }

  async getLiveConfig(server: ServerRecord): Promise<LiveConfig> {
    const document = await this.gateway.download(this.providerId(server));
    return { config: mapReforgerConfig(document.root), revision: document.revision };
  }

  async sync(server: ServerRecord): Promise<ConfigSyncResult> {
    const { config } = await this.getLiveConfig(server);
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
