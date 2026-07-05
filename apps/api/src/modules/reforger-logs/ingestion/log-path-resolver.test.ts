import { describe, expect, it } from 'vitest';
import { createLogPathResolver, dateFromLogPath } from './log-path-resolver.js';
import type { GameServerProvider, ServerFileEntry } from '../../pterodactyl/types.js';

function providerWithListing(entries: ServerFileEntry[]): GameServerProvider {
  return {
    listFiles: async () => entries,
  } as unknown as GameServerProvider;
}

function dir(name: string, modifiedAt: Date | null): ServerFileEntry {
  return { name, isFile: false, sizeBytes: 0, modifiedAt };
}

describe('dateFromLogPath', () => {
  it('extracts the session start time from dated folder names', () => {
    expect(
      dateFromLogPath('/profile/logs/logs_2026-07-04_12-54-04/console.log')?.toISOString(),
    ).toBe('2026-07-04T12:54:04.000Z');
  });

  it('returns null for paths without a dated folder', () => {
    expect(dateFromLogPath('/profile/logs/console.log')).toBeNull();
  });
});

describe('createLogPathResolver', () => {
  it('uses the explicit path when configured, without listing files', async () => {
    const resolve = createLogPathResolver({
      provider: providerWithListing([]),
      providerServerId: 'x',
      explicitPath: '/profile/logs/pinned.log',
      directory: '/profile/logs',
      fileName: 'console.log',
    });
    expect(await resolve()).toBe('/profile/logs/pinned.log');
  });

  it('picks the newest dated logs_* folder', async () => {
    const resolve = createLogPathResolver({
      provider: providerWithListing([
        dir('logs_2026-07-04_12-54-04', new Date('2026-07-04T12:54:04Z')),
        dir('logs_2026-07-05_08-10-00', new Date('2026-07-05T08:10:00Z')),
        dir('backups', new Date('2026-07-05T09:00:00Z')),
      ]),
      providerServerId: 'x',
      explicitPath: '',
      directory: '/profile/logs',
      fileName: 'console.log',
    });
    expect(await resolve()).toBe('/profile/logs/logs_2026-07-05_08-10-00/console.log');
  });

  it('falls back to name ordering when modified times are missing', async () => {
    const resolve = createLogPathResolver({
      provider: providerWithListing([
        dir('logs_2026-07-03_23-00-00', null),
        dir('logs_2026-07-05_01-00-00', null),
      ]),
      providerServerId: 'x',
      explicitPath: '',
      directory: '/profile/logs',
      fileName: 'console.log',
    });
    expect(await resolve()).toBe('/profile/logs/logs_2026-07-05_01-00-00/console.log');
  });

  it('prefers a stable file directly in the directory', async () => {
    const resolve = createLogPathResolver({
      provider: providerWithListing([
        { name: 'console.log', isFile: true, sizeBytes: 10, modifiedAt: new Date() },
        dir('logs_2026-07-05_01-00-00', new Date()),
      ]),
      providerServerId: 'x',
      explicitPath: '',
      directory: '/profile/logs/',
      fileName: 'console.log',
    });
    expect(await resolve()).toBe('/profile/logs/console.log');
  });

  it('returns null when nothing matches', async () => {
    const resolve = createLogPathResolver({
      provider: providerWithListing([dir('backups', new Date())]),
      providerServerId: 'x',
      explicitPath: '',
      directory: '/profile/logs',
      fileName: 'console.log',
    });
    expect(await resolve()).toBeNull();
  });
});
