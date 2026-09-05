import type {
  ConfigPatchOp,
  ConfigPatchResult,
  ConfigRawResponse,
  ConfigTreeResponse,
  StartupMirror,
} from '@reforger-panel/shared';
import { ApiError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { GameServerProvider } from '../pterodactyl/types.js';
import type { ServerRecord } from '../servers/server-service.js';
import type { ConfigFileGateway } from './config-file-gateway.js';
import { applyConfigOps, flattenConfig, verifyConfigOps } from './config-tree.js';
import type { ConfigSyncService } from './config-sync.js';
import { detectStartupMirrors, mirrorsForPath } from './startup-mirrors.js';

function providerId(server: ServerRecord): string {
  return server.pterodactylServerId ?? server.slug;
}

/**
 * The general-purpose config.json editor: every key the file actually
 * contains, addressed by path, patched one field at a time.
 *
 * The old editor could only reach eleven hardcoded keys and submitted all of
 * them on every save, so a stale form quietly reverted whatever anyone else
 * had changed. Here only the paths the user touched are sent, and the write is
 * refused outright if the file moved since it was loaded.
 */
export class ConfigEditorService {
  constructor(
    private readonly gateway: ConfigFileGateway,
    private readonly provider: GameServerProvider,
    private readonly configSync: ConfigSyncService,
    private readonly logger: Logger,
  ) {}

  private async loadMirrors(
    server: ServerRecord,
    root: Record<string, unknown>,
  ): Promise<StartupMirror[]> {
    const variables = await this.provider
      .listStartupVariables(providerId(server))
      .then((list) =>
        list.map((variable) => ({
          name: variable.name,
          description: variable.description,
          envVariable: variable.envVariable,
          value: variable.serverValue,
          defaultValue: variable.defaultValue,
          isEditable: variable.isEditable,
        })),
      )
      .catch(() => []);
    return detectStartupMirrors(root, variables);
  }

  async getTree(server: ServerRecord): Promise<ConfigTreeResponse> {
    const document = await this.gateway.download(providerId(server));
    return {
      entries: flattenConfig(document.root),
      mirrors: await this.loadMirrors(server, document.root),
      revision: document.revision,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getRaw(server: ServerRecord): Promise<ConfigRawResponse> {
    const document = await this.gateway.download(providerId(server));
    return {
      content: document.raw,
      revision: document.revision,
      fetchedAt: new Date().toISOString(),
    };
  }

  async putRaw(
    server: ServerRecord,
    content: string,
    expectedRevision?: string,
  ): Promise<ConfigRawResponse> {
    const document = await this.gateway.replace(providerId(server), content, expectedRevision);
    await this.afterWrite(server);
    return {
      content: document.raw,
      revision: document.revision,
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * Applies field-level edits. When `writeStartupVars` is set, any changed path
   * that the egg also templates from a startup variable is written to both
   * places, so the change survives the next restart.
   */
  async patch(
    server: ServerRecord,
    ops: readonly ConfigPatchOp[],
    options: { expectedRevision?: string; writeStartupVars?: boolean } = {},
  ): Promise<ConfigPatchResult> {
    if (ops.length === 0) {
      const current = await this.gateway.download(providerId(server));
      return {
        changedPaths: [],
        startupVarsWritten: [],
        revision: current.revision,
        fetchedAt: new Date().toISOString(),
        requiresRestart: true,
      };
    }

    let changedPaths: string[] = [];
    const document = await this.gateway.mutate(providerId(server), {
      expectedRevision: options.expectedRevision,
      apply: (root) => {
        changedPaths = applyConfigOps(root, ops);
      },
      verify: (readBack) => {
        const failed = verifyConfigOps(readBack, ops);
        if (failed) {
          throw ApiError.upstream(
            `Config write verification failed for "${failed}" — the file on the server does not match. Check config.json.bak.`,
          );
        }
      },
    });

    const startupVarsWritten = options.writeStartupVars
      ? await this.mirrorChangedPaths(server, document.root, ops, changedPaths)
      : [];

    await this.afterWrite(server);

    this.logger.info(
      { serverId: server.id, changedPaths, startupVarsWritten },
      'config.json updated',
    );

    return {
      changedPaths,
      startupVarsWritten,
      revision: document.revision,
      fetchedAt: new Date().toISOString(),
      requiresRestart: true,
    };
  }

  private async mirrorChangedPaths(
    server: ServerRecord,
    root: Record<string, unknown>,
    ops: readonly ConfigPatchOp[],
    changedPaths: readonly string[],
  ): Promise<string[]> {
    const mirrors = await this.loadMirrors(server, root);
    const written: string[] = [];
    for (const path of changedPaths) {
      const op = ops.find((candidate) => candidate.path === path);
      if (!op || op.value === null) continue;
      for (const mirror of mirrorsForPath(path, mirrors)) {
        try {
          await this.provider.updateStartupVariable(
            providerId(server),
            mirror.envVariable,
            String(op.value),
          );
          written.push(mirror.envVariable);
        } catch (error) {
          // Some eggs mark variables read-only; that is not fatal for the
          // config write that already succeeded.
          this.logger.warn(
            { serverId: server.id, envVariable: mirror.envVariable, err: String(error) },
            'startup variable mirror write failed',
          );
        }
      }
    }
    return written;
  }

  private async afterWrite(server: ServerRecord): Promise<void> {
    await this.configSync.sync(server).catch((error) => {
      this.logger.warn(
        { serverId: server.id, err: String(error) },
        'post-write config sync failed',
      );
    });
  }
}
