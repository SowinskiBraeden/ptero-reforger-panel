import { ApiError } from '../../lib/errors.js';
import type { GameServerProvider } from '../pterodactyl/types.js';

const CONFIG_MAX_BYTES = 256 * 1024;

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Shared read-modify-write access to the server's config.json: size-guarded
 * download + parse, and a write path that backs the previous content up to
 * `<config>.bak` and verifies the upload by downloading it again. Callers
 * mutate only their own keys on the parsed document so everything else in the
 * file passes through untouched.
 */
export class ConfigFileGateway {
  constructor(
    private readonly provider: GameServerProvider,
    readonly configPath: string,
  ) {}

  async download(
    providerServerId: string,
  ): Promise<{ raw: string; root: Record<string, unknown> }> {
    const file = await this.provider.downloadTextFile(
      providerServerId,
      this.configPath,
      CONFIG_MAX_BYTES,
    );
    if (file.truncated) {
      throw ApiError.upstream('Server config.json is unexpectedly large; refusing to modify it.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.content.replace(/^\uFEFF/, ''));
    } catch {
      throw ApiError.upstream('Server config.json is not valid JSON.');
    }
    const root = asRecord(parsed);
    if (!root || !asRecord(root.game)) {
      throw ApiError.upstream('Server config.json has no "game" section; refusing to modify it.');
    }
    return { raw: file.content, root };
  }

  /**
   * Backs up `previousRaw`, writes the mutated document, downloads it again
   * and hands the verified parsed result to `verify` (throw there to fail).
   */
  async write(
    providerServerId: string,
    root: Record<string, unknown>,
    previousRaw: string,
    verify: (readBack: Record<string, unknown>) => void,
  ): Promise<Record<string, unknown>> {
    await this.provider.writeTextFile(providerServerId, `${this.configPath}.bak`, previousRaw);
    const serialized = `${JSON.stringify(root, null, 4)}\n`;
    await this.provider.writeTextFile(providerServerId, this.configPath, serialized);
    const readBack = await this.download(providerServerId);
    verify(readBack.root);
    return readBack.root;
  }
}
