import type { GameServerProvider } from '../../pterodactyl/types.js';
import type { LogSource } from './types.js';

/**
 * LogSource backed by the game server provider (Pterodactyl Client API or the
 * mock). Retrieval is size-capped tail download; if the panel ever needs
 * range/tail requests, only this adapter changes.
 */
export class PterodactylLogSource implements LogSource {
  constructor(private readonly provider: GameServerProvider) {}

  fetchLog(serverId: string, logPath: string, maxBytes: number) {
    return this.provider.downloadTextFile(serverId, logPath, maxBytes);
  }
}
