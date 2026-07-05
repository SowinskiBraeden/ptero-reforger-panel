import type { GameServerProvider } from '../../pterodactyl/types.js';

export type LogPathResolver = () => Promise<string | null>;

/** Directories the Reforger server creates per boot, e.g. logs_2026-07-04_12-54-04. */
const DATED_LOG_DIR_PATTERN = /^logs[_-]/i;

const LOG_PATH_DATE_PATTERN = /logs[_-](\d{4})-(\d{2})-(\d{2})[_-](\d{2})-(\d{2})-(\d{2})/i;

/**
 * Reforger's per-boot folder names encode the session start time; use it to
 * anchor line timestamps when the parsed chunk has no "Log started" header
 * and no prior cursor context.
 */
export function dateFromLogPath(logPath: string): Date | null {
  const match = LOG_PATH_DATE_PATTERN.exec(logPath);
  if (!match) return null;
  const [, year, month, day, hours, minutes, seconds] = match;
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
      Number(seconds),
    ),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Resolves the current Reforger log file path.
 *
 * - `REFORGER_ADMIN_LOG_PATH` (explicit file) wins when set.
 * - Otherwise `REFORGER_LOG_DIRECTORY` is listed on every sync and the newest
 *   dated `logs_*` subdirectory is used, so per-boot log folders are picked up
 *   automatically after restarts. `REFORGER_LOG_FILE_PATTERN` is the file name
 *   inside that directory (default `console.log`).
 */
export function createLogPathResolver(options: {
  provider: GameServerProvider;
  providerServerId: string;
  explicitPath: string;
  directory: string;
  fileName: string;
}): LogPathResolver {
  const fileName = options.fileName || 'console.log';
  return async () => {
    if (options.explicitPath) return options.explicitPath;
    if (!options.directory) return null;
    const directory = options.directory.replace(/\/$/, '');

    const entries = await options.provider.listFiles(options.providerServerId, directory);

    // A stable file directly in the directory takes priority.
    if (entries.some((entry) => entry.isFile && entry.name === fileName)) {
      return `${directory}/${fileName}`;
    }

    const datedDirs = entries.filter(
      (entry) => !entry.isFile && DATED_LOG_DIR_PATTERN.test(entry.name),
    );
    if (datedDirs.length === 0) return null;
    datedDirs.sort((a, b) => {
      const byTime = (b.modifiedAt?.getTime() ?? 0) - (a.modifiedAt?.getTime() ?? 0);
      // Names embed sortable timestamps (logs_YYYY-MM-DD_HH-MM-SS); use them
      // as a tiebreaker when mtimes are missing or equal.
      return byTime !== 0 ? byTime : b.name.localeCompare(a.name);
    });
    return `${directory}/${datedDirs[0]!.name}/${fileName}`;
  };
}
