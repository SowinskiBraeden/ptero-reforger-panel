import { createHash } from 'node:crypto';
import { ApiError } from '../../lib/errors.js';
import type { GameServerProvider } from '../pterodactyl/types.js';

const CONFIG_MAX_BYTES = 256 * 1024;

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export type ConfigDocument = {
  raw: string;
  root: Record<string, unknown>;
  /** Content hash of `raw`. Callers echo it back to prove what they edited. */
  revision: string;
  /** Indentation detected in the source file, reused when writing. */
  indent: string;
};

function revisionOf(raw: string): string {
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/** Keeps the file looking the way its author left it instead of reformatting. */
function detectIndent(raw: string): string {
  const match = /\n([ \t]+)"/.exec(raw);
  return match?.[1] ?? '  ';
}

/**
 * Shared read-modify-write access to the server's config.json.
 *
 * Three properties matter here, and all three were missing before:
 *
 * 1. **Serialisation.** Every mutation runs under a per-server lock, so a mod
 *    list write and a settings write can no longer interleave, lose each
 *    other's changes, and overwrite the same `.bak`.
 * 2. **Optimistic concurrency.** Callers pass the revision their edits were
 *    based on; if the file moved underneath them the write is rejected as a
 *    conflict instead of silently reverting somebody else's change.
 * 3. **Read-back verification.** The upload is downloaded again and checked
 *    before the call is reported as successful.
 *
 * Callers mutate only their own keys on the parsed document, so everything
 * else in the file passes through untouched.
 */
export class ConfigFileGateway {
  /** Tail of the pending operation chain, per provider server id. */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly provider: GameServerProvider,
    readonly configPath: string,
  ) {}

  private withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    // Swallow rejections on the chain itself so one failure cannot poison
    // every subsequent operation.
    this.locks.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  private async read(providerServerId: string): Promise<ConfigDocument> {
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
    if (!root) {
      throw ApiError.upstream('Server config.json is not a JSON object.');
    }
    if (!asRecord(root.game)) {
      throw ApiError.upstream('Server config.json has no "game" section; refusing to modify it.');
    }
    return {
      raw: file.content,
      root,
      revision: revisionOf(file.content),
      indent: detectIndent(file.content),
    };
  }

  /** Reads the current document. Waits for any in-flight write to finish. */
  async download(providerServerId: string): Promise<ConfigDocument> {
    return this.withLock(providerServerId, () => this.read(providerServerId));
  }

  /**
   * Applies `apply` to a freshly-read document and writes it back, keeping a
   * `<config>.bak` of the previous content. `verify` receives the re-downloaded
   * document and should throw if the change did not land.
   *
   * Pass `expectedRevision` to reject the write when the file changed since the
   * caller loaded it.
   */
  async mutate(
    providerServerId: string,
    options: {
      expectedRevision?: string | undefined;
      apply: (root: Record<string, unknown>) => void;
      verify: (readBack: Record<string, unknown>) => void;
    },
  ): Promise<ConfigDocument> {
    return this.withLock(providerServerId, async () => {
      const current = await this.read(providerServerId);
      if (options.expectedRevision && options.expectedRevision !== current.revision) {
        throw ApiError.conflict(
          'config.json changed on the server since you loaded it. Refresh and re-apply your changes.',
        );
      }

      options.apply(current.root);

      const serialized = `${JSON.stringify(current.root, null, current.indent)}\n`;
      if (serialized === current.raw) {
        return current; // nothing to do; skip the write and the backup churn
      }

      await this.provider.writeTextFile(providerServerId, `${this.configPath}.bak`, current.raw);
      await this.provider.writeTextFile(providerServerId, this.configPath, serialized);

      const readBack = await this.read(providerServerId);
      options.verify(readBack.root);
      return readBack;
    });
  }

  /** Replaces the whole file. Used by the raw JSON editor. */
  async replace(
    providerServerId: string,
    content: string,
    expectedRevision?: string,
  ): Promise<ConfigDocument> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content.replace(/^\uFEFF/, ''));
    } catch {
      throw ApiError.validation('That is not valid JSON.');
    }
    const root = asRecord(parsed);
    if (!root || !asRecord(root.game)) {
      throw ApiError.validation('config.json must be an object with a "game" section.');
    }
    return this.withLock(providerServerId, async () => {
      const current = await this.read(providerServerId);
      if (expectedRevision && expectedRevision !== current.revision) {
        throw ApiError.conflict(
          'config.json changed on the server since you loaded it. Refresh and re-apply your changes.',
        );
      }
      const normalized = content.endsWith('\n') ? content : `${content}\n`;
      if (normalized === current.raw) return current;
      await this.provider.writeTextFile(providerServerId, `${this.configPath}.bak`, current.raw);
      await this.provider.writeTextFile(providerServerId, this.configPath, normalized);
      return this.read(providerServerId);
    });
  }
}
