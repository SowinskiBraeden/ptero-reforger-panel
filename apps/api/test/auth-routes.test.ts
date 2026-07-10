import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Role } from '@reforger-panel/shared';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { createLogger } from '../src/lib/logger.js';
import type { Db } from '../src/db/client.js';
import {
  resolveRoleForLogin,
  type SessionService,
  type SessionUser,
} from '../src/modules/auth/session-service.js';
import type { ServerModsService } from '../src/modules/config/mods-service.js';
import type { PerformanceSettingsService } from '../src/modules/config/performance-service.js';
import type { ResourceHistoryService } from '../src/modules/servers/resource-history.js';
import { MockGameServerProvider } from '../src/modules/pterodactyl/mock-provider.js';
import type { IngestionScheduler } from '../src/modules/reforger-logs/ingestion/scheduler.js';
import type { ServerRecord, ServerService } from '../src/modules/servers/server-service.js';
import { WorkshopClient } from '../src/modules/workshop/workshop-client.js';

const OWNER_ID = '111111111111111111';

const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://unused',
  SESSION_SECRET: 'a'.repeat(40),
  OWNER_DISCORD_ID: OWNER_ID,
  USE_MOCK_PTERODACTYL: 'true',
};

function makeUser(role: Role): SessionUser {
  return {
    id: `user-${role}`,
    discordId: `discord-${role}`,
    username: role,
    displayName: role,
    avatarUrl: null,
    role,
  };
}

const TOKENS: Record<string, SessionUser> = {
  'owner-token': makeUser('owner'),
  'admin-token': makeUser('server_admin'),
  'lead-token': makeUser('mission_lead'),
  'viewer-token': makeUser('viewer'),
};

const trainingServer: ServerRecord = {
  id: 'srv-1',
  slug: 'training-server',
  name: 'Training Server',
  providerType: 'pterodactyl',
  pterodactylServerId: null,
  status: 'online',
  maxPlayers: 20,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildApp() {
  const env = loadEnv(TEST_ENV as NodeJS.ProcessEnv);
  const provider = new MockGameServerProvider();
  const activity: { action: string; actorUserId: string | null }[] = [];

  const sessions = {
    getUserBySessionToken: async (token: string) => TOKENS[token] ?? null,
    revokeSession: async () => undefined,
  } as unknown as SessionService;

  const servers = {
    getServerBySlug: async (slug: string) => (slug === 'training-server' ? trainingServer : null),
    listServers: async () => [trainingServer],
    countOnlinePlayers: async () => 0,
    updateStatus: async () => undefined,
    recordActivity: async (input: { action: string; actorUserId: string | null }) => {
      activity.push(input);
    },
    getOnlinePlayers: async () => ({
      players: [],
      onlineCount: 0,
      maxPlayers: 20,
      lastSyncedAt: null,
      stale: true,
    }),
    getActivity: async () => [],
    getConfiguration: async () => ({ current: null, history: [] }),
    getModPacks: async () => [],
    getKnownPlayers: async () => [],
    getLogCursor: async () => null,
  } as unknown as ServerService;

  const scheduler = {
    syncNow: async () => ({
      serverId: 'srv-1',
      logPath: '/profile/logs/console.log',
      fetchedBytes: 0,
      processedLines: 0,
      createdEvents: 0,
      updatedSessions: 0,
      cursorReset: false,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      ignoredLines: 0,
      invalidTimestamps: 0,
      reason: 'no_new_data',
    }),
    getLastResult: () => null,
  } as unknown as IngestionScheduler;

  const app = createApp({
    env,
    logger: createLogger('silent'),
    db: {} as Db,
    sessions,
    servers,
    provider,
    workshop: new WorkshopClient({ baseUrl: 'https://workshop.invalid' }),
    scheduler,
    resolveLogPath: async () => '/profile/logs/console.log',
    configSync: null,
    mods: {
      getMods: async () => ({ mods: [], fetchedAt: new Date().toISOString() }),
      setMods: async () => ({
        mods: [],
        fetchedAt: new Date().toISOString(),
        added: 0,
        removed: 0,
        requiresRestart: true as const,
      }),
    } as unknown as ServerModsService,
    performance: {
      get: async () => ({ settings: {}, fetchedAt: new Date().toISOString() }),
      update: async (_server: unknown, settings: unknown) => ({
        settings,
        fetchedAt: new Date().toISOString(),
        changedFields: [],
        requiresRestart: true as const,
      }),
    } as unknown as PerformanceSettingsService,
    resourceHistory: {
      history: () => ({ samples: [], intervalSeconds: 15 }),
    } as unknown as ResourceHistoryService,
    missions: null,
  });
  return { app, provider, activity };
}

function asUser(token: string) {
  return { Cookie: `rp_session=${token}`, 'X-CSRF-Protection': '1' };
}

describe('authentication and roles', () => {
  it('rejects unauthenticated requests to /api/auth/me', async () => {
    const { app } = buildApp();
    const response = await request(app).get('/api/auth/me');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the current user with capabilities', async () => {
    const { app } = buildApp();
    const response = await request(app).get('/api/auth/me').set(asUser('viewer-token'));
    expect(response.status).toBe(200);
    expect(response.body.role).toBe('viewer');
    expect(response.body.capabilities).toEqual(['server.view']);
  });

  it('bootstraps the owner role from OWNER_DISCORD_ID and defaults others to viewer', () => {
    expect(resolveRoleForLogin(null, OWNER_ID, OWNER_ID)).toBe('owner');
    expect(resolveRoleForLogin('viewer', OWNER_ID, OWNER_ID)).toBe('owner');
    expect(resolveRoleForLogin(null, '222', OWNER_ID)).toBe('viewer');
    expect(resolveRoleForLogin('server_admin', '222', OWNER_ID)).toBe('server_admin');
    // No owner configured: nobody is silently promoted.
    expect(resolveRoleForLogin(null, '', '')).toBe('viewer');
  });

  it('requires authentication on server routes', async () => {
    const { app } = buildApp();
    const response = await request(app).get('/api/servers');
    expect(response.status).toBe(401);
  });
});

describe('power controls by role', () => {
  const cases: { token: string; action: string; expected: number }[] = [
    { token: 'owner-token', action: 'start', expected: 200 },
    { token: 'owner-token', action: 'stop', expected: 200 },
    { token: 'owner-token', action: 'restart', expected: 200 },
    { token: 'admin-token', action: 'start', expected: 200 },
    { token: 'admin-token', action: 'stop', expected: 200 },
    { token: 'admin-token', action: 'restart', expected: 200 },
    { token: 'lead-token', action: 'restart', expected: 200 },
    { token: 'lead-token', action: 'start', expected: 403 },
    { token: 'lead-token', action: 'stop', expected: 403 },
    { token: 'viewer-token', action: 'start', expected: 403 },
    { token: 'viewer-token', action: 'stop', expected: 403 },
    { token: 'viewer-token', action: 'restart', expected: 403 },
  ];

  for (const { token, action, expected } of cases) {
    it(`${token.replace('-token', '')} ${action} → ${expected}`, async () => {
      const { app } = buildApp();
      const response = await request(app)
        .post(`/api/servers/training-server/power/${action}`)
        .set(asUser(token));
      expect(response.status).toBe(expected);
      if (expected === 403) {
        expect(response.body.error.code).toBe('FORBIDDEN');
      }
    });
  }

  it('simulated power actions still create activity records', async () => {
    const { app, activity } = buildApp();
    await request(app)
      .post('/api/servers/training-server/power/restart')
      .set(asUser('lead-token'))
      .expect(200);
    expect(activity).toHaveLength(1);
    expect(activity[0]!.action).toBe('server.power.restart');
  });
});

describe('manual log sync and diagnostics', () => {
  it('allows only the owner to trigger a manual sync', async () => {
    const { app } = buildApp();
    await request(app)
      .post('/api/servers/training-server/logs/sync')
      .set(asUser('owner-token'))
      .expect(200);
    for (const token of ['admin-token', 'lead-token', 'viewer-token']) {
      const response = await request(app)
        .post('/api/servers/training-server/logs/sync')
        .set(asUser(token));
      expect(response.status).toBe(403);
    }
  });

  it('hides log ingestion health from mission leads and viewers', async () => {
    const { app } = buildApp();
    await request(app)
      .get('/api/servers/training-server/logs/health')
      .set(asUser('admin-token'))
      .expect(200);
    await request(app)
      .get('/api/servers/training-server/logs/health')
      .set(asUser('lead-token'))
      .expect(403);
  });

  it('restricts user management to the owner', async () => {
    const { app } = buildApp();
    const response = await request(app).get('/api/users').set(asUser('viewer-token'));
    expect(response.status).toBe(403);
  });
});

describe('mod management by role', () => {
  it('allows owner and server_admin to update mods', async () => {
    const { app } = buildApp();
    for (const token of ['owner-token', 'admin-token']) {
      const response = await request(app)
        .put('/api/servers/training-server/mods')
        .set(asUser(token))
        .send({ mods: [{ modId: '591AF5BDA9F7CE8B', name: 'X' }] });
      expect(response.status).toBe(200);
    }
  });

  it('forbids mission leads and viewers from updating mods', async () => {
    const { app } = buildApp();
    for (const token of ['lead-token', 'viewer-token']) {
      const response = await request(app)
        .put('/api/servers/training-server/mods')
        .set(asUser(token))
        .send({ mods: [] });
      expect(response.status).toBe(403);
    }
  });

  it('rejects invalid mod ids and duplicates', async () => {
    const { app } = buildApp();
    const bad = await request(app)
      .put('/api/servers/training-server/mods')
      .set(asUser('owner-token'))
      .send({ mods: [{ modId: 'not-a-mod-id' }] });
    expect(bad.status).toBe(400);

    const dup = await request(app)
      .put('/api/servers/training-server/mods')
      .set(asUser('owner-token'))
      .send({
        mods: [{ modId: '591AF5BDA9F7CE8B' }, { modId: '591af5bda9f7ce8b' }],
      });
    expect(dup.status).toBe(400);
  });
});

describe('schedule management by role', () => {
  it('allows owner and server_admin to view schedules', async () => {
    const { app } = buildApp();
    await request(app)
      .get('/api/servers/training-server/schedules')
      .set(asUser('owner-token'))
      .expect(200);
    await request(app)
      .get('/api/servers/training-server/schedules')
      .set(asUser('admin-token'))
      .expect(200);
    await request(app)
      .get('/api/servers/training-server/schedules')
      .set(asUser('lead-token'))
      .expect(403);
  });

  it('creates restart schedules through the provider and records activity', async () => {
    const { app, activity } = buildApp();
    const response = await request(app)
      .post('/api/servers/training-server/schedules/restarts')
      .set(asUser('admin-token'))
      .send({
        name: 'Morning restart',
        isActive: true,
        minute: 30,
        hour: 8,
        dayOfWeek: '*',
        onlyWhenOnline: true,
      });
    expect(response.status).toBe(200);
    expect(response.body.schedule.name).toBe('Morning restart');
    expect(response.body.schedule.tasks[0].payload).toBe('restart');
    expect(activity.at(-1)?.action).toBe('schedule.restart.created');
  });
});

describe('performance config by role', () => {
  const validBody = {
    maxPlayers: 32,
    serverMaxViewDistance: null,
    networkViewDistance: null,
    serverMinGrassDistance: null,
    disableThirdPerson: null,
    fastValidation: null,
    battlEye: null,
    disableAI: null,
    aiLimit: null,
    playerSaveTime: null,
    slotReservationTimeout: null,
    lobbyPlayerSynchronise: null,
  };

  it('allows owner and server_admin, forbids mission_lead and viewer', async () => {
    const { app } = buildApp();
    for (const token of ['owner-token', 'admin-token']) {
      await request(app)
        .put('/api/servers/training-server/config/performance')
        .set(asUser(token))
        .send(validBody)
        .expect(200);
    }
    for (const token of ['lead-token', 'viewer-token']) {
      await request(app)
        .put('/api/servers/training-server/config/performance')
        .set(asUser(token))
        .send(validBody)
        .expect(403);
    }
  });

  it('rejects out-of-range values with the offending field named', async () => {
    const { app } = buildApp();
    const response = await request(app)
      .put('/api/servers/training-server/config/performance')
      .set(asUser('owner-token'))
      .send({ ...validBody, serverMaxViewDistance: 99999 });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('serverMaxViewDistance');
  });

  it('serves resource history to any authenticated user', async () => {
    const { app } = buildApp();
    const response = await request(app)
      .get('/api/servers/training-server/resources/history')
      .set(asUser('viewer-token'));
    expect(response.status).toBe(200);
    expect(response.body.intervalSeconds).toBe(15);
  });
});

describe('invites', () => {
  it('restricts invite management to the owner', async () => {
    const { app } = buildApp();
    for (const token of ['admin-token', 'lead-token', 'viewer-token']) {
      const response = await request(app).get('/api/invites').set(asUser(token));
      expect(response.status).toBe(403);
    }
  });

  it('rejects malformed redeem codes before touching the database', async () => {
    const { app } = buildApp();
    const response = await request(app)
      .post('/api/invites/redeem')
      .set(asUser('viewer-token'))
      .send({ code: '' });
    expect(response.status).toBe(400);
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without the CSRF header', async () => {
    const { app } = buildApp();
    const response = await request(app)
      .post('/api/servers/training-server/power/restart')
      .set('Cookie', 'rp_session=owner-token');
    expect(response.status).toBe(403);
  });

  it('rejects cross-origin state-changing requests', async () => {
    const { app } = buildApp();
    const response = await request(app)
      .post('/api/servers/training-server/power/restart')
      .set(asUser('owner-token'))
      .set('Origin', 'https://evil.example.com');
    expect(response.status).toBe(403);
  });
});
