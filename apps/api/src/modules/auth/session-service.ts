import { eq, lt } from 'drizzle-orm';
import type { Role } from '@reforger-panel/shared';
import type { Db } from '../../db/client.js';
import { schema } from '../../db/client.js';
import { generateToken, hashSessionToken } from '../../lib/crypto.js';
import type { DiscordProfile } from './discord.js';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, revocable server-side

export type SessionUser = {
  id: string;
  discordId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: Role;
};

/**
 * Role assignment at login: the configured owner Discord ID always gets (and
 * keeps) `owner`; existing users keep their locally-assigned role; everyone
 * new starts as `viewer`.
 */
export function resolveRoleForLogin(
  existingRole: Role | null,
  discordId: string,
  ownerDiscordId: string,
): Role {
  if (ownerDiscordId !== '' && discordId === ownerDiscordId) return 'owner';
  return existingRole ?? 'viewer';
}

export class SessionService {
  constructor(
    private readonly db: Db,
    private readonly ownerDiscordId: string,
  ) {}

  /** Create or update the local user record for a Discord login. */
  async upsertUserFromDiscord(profile: DiscordProfile): Promise<SessionUser> {
    const existing = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, profile.discordId));

    if (existing[0]) {
      const nextRole = resolveRoleForLogin(
        existing[0].role,
        profile.discordId,
        this.ownerDiscordId,
      );
      const [updated] = await this.db
        .update(schema.users)
        .set({
          username: profile.username,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          role: nextRole,
        })
        .where(eq(schema.users.id, existing[0].id))
        .returning();
      return updated!;
    }

    const [created] = await this.db
      .insert(schema.users)
      .values({
        discordId: profile.discordId,
        username: profile.username,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        role: resolveRoleForLogin(null, profile.discordId, this.ownerDiscordId),
      })
      .returning();
    return created!;
  }

  async setRole(userId: string, role: Role): Promise<SessionUser | null> {
    const [updated] = await this.db
      .update(schema.users)
      .set({ role })
      .where(eq(schema.users.id, userId))
      .returning();
    return updated ?? null;
  }

  /** Returns the raw token for the cookie; only its hash is persisted. */
  async createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.db.insert(schema.sessions).values({
      id: hashSessionToken(token),
      userId,
      expiresAt,
    });
    return { token, expiresAt };
  }

  async getUserBySessionToken(token: string): Promise<SessionUser | null> {
    const rows = await this.db
      .select({ session: schema.sessions, user: schema.users })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(eq(schema.sessions.id, hashSessionToken(token)));
    const row = rows[0];
    if (!row) return null;
    if (row.session.expiresAt.getTime() <= Date.now()) {
      await this.db.delete(schema.sessions).where(eq(schema.sessions.id, row.session.id));
      return null;
    }
    return row.user;
  }

  async revokeSession(token: string): Promise<void> {
    await this.db.delete(schema.sessions).where(eq(schema.sessions.id, hashSessionToken(token)));
  }

  async deleteExpiredSessions(): Promise<void> {
    await this.db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
  }
}
