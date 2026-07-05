import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { InviteSummary, Role } from '@reforger-panel/shared';
import { ROLES } from '@reforger-panel/shared';
import type { Db } from '../../db/client.js';
import { schema } from '../../db/client.js';
import { ApiError } from '../../lib/errors.js';
import { rateLimit } from '../../lib/rate-limit.js';
import { requireAuth, requireCapability } from '../auth/auth-middleware.js';

const createBodySchema = z.object({
  // Owner invites are deliberately not creatable; there is one owner.
  role: z.enum(['server_admin', 'mission_lead', 'viewer']),
  expiresInHours: z.number().int().min(1).max(8760).nullable().default(168),
});

const NEVER_EXPIRES_HOURS = 24 * 365 * 100;

const redeemBodySchema = z.object({
  code: z.string().trim().min(4).max(64),
});

function inviteCode(): string {
  // Readable, unambiguous, ~50 bits.
  return randomBytes(10).toString('base64url').replace(/[-_]/g, 'x').slice(0, 12).toUpperCase();
}

export function createInviteRouter(db: Db): Router {
  const router = Router();
  const redeemRateLimit = rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'invite-redeem' });

  router.use(requireAuth);

  /**
   * Redeem an invite: upgrades the calling user to the invite's role and
   * consumes the code. Available to any signed-in user (rate limited).
   */
  router.post('/redeem', redeemRateLimit, async (req, res, next) => {
    try {
      const body = redeemBodySchema.safeParse(req.body);
      if (!body.success) throw ApiError.validation('Invalid invite code.');
      const user = req.user!;

      const rows = await db
        .select()
        .from(schema.invites)
        .where(
          and(
            eq(schema.invites.code, body.data.code.toUpperCase()),
            isNull(schema.invites.usedAt),
            gt(schema.invites.expiresAt, new Date()),
          ),
        );
      const invite = rows[0];
      if (!invite) {
        throw ApiError.notFound('This invite code is invalid, used, or expired.');
      }
      if (user.role === 'owner') {
        // Owners never downgrade themselves by redeeming a code.
        res.json({ ok: true, role: user.role, changed: false });
        return;
      }

      await db
        .update(schema.invites)
        .set({ usedByUserId: user.id, usedAt: new Date() })
        .where(eq(schema.invites.id, invite.id));
      await db
        .update(schema.users)
        .set({ role: invite.role as Role })
        .where(eq(schema.users.id, user.id));
      res.json({ ok: true, role: invite.role, changed: invite.role !== user.role });
    } catch (error) {
      next(error);
    }
  });

  router.use(requireCapability('users.manage', 'Only the owner can manage invites.'));

  router.get('/', async (_req, res, next) => {
    try {
      const rows = await db
        .select({ invite: schema.invites, createdBy: schema.users })
        .from(schema.invites)
        .leftJoin(schema.users, eq(schema.users.id, schema.invites.createdByUserId))
        .orderBy(desc(schema.invites.createdAt))
        .limit(50);

      const usedByIds = rows
        .map((r) => r.invite.usedByUserId)
        .filter((id): id is string => id !== null);
      const usedByUsers = usedByIds.length > 0 ? await db.select().from(schema.users) : [];
      const usedByName = new Map(usedByUsers.map((u) => [u.id, u.displayName ?? u.username]));

      const invites: InviteSummary[] = rows.map(({ invite, createdBy }) => ({
        id: invite.id,
        code: invite.code,
        role: invite.role,
        createdBy: createdBy ? (createdBy.displayName ?? createdBy.username) : null,
        expiresAt: invite.expiresAt?.toISOString() ?? null,
        usedBy: invite.usedByUserId ? (usedByName.get(invite.usedByUserId) ?? 'unknown') : null,
        usedAt: invite.usedAt?.toISOString() ?? null,
        createdAt: invite.createdAt.toISOString(),
      }));
      res.json({ invites });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const body = createBodySchema.safeParse(req.body);
      if (!body.success) throw ApiError.validation('Invalid invite request.');
      if (!ROLES.includes(body.data.role)) throw ApiError.validation('Invalid role.');
      const [invite] = await db
        .insert(schema.invites)
        .values({
          code: inviteCode(),
          role: body.data.role,
          createdByUserId: req.user!.id,
          expiresAt: new Date(
            Date.now() + (body.data.expiresInHours ?? NEVER_EXPIRES_HOURS) * 60 * 60 * 1000,
          ),
        })
        .returning();
      res.json({
        id: invite!.id,
        code: invite!.code,
        role: invite!.role,
        expiresAt: invite!.expiresAt?.toISOString() ?? null,
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const id = z.string().uuid().safeParse(req.params.id);
      if (!id.success) throw ApiError.validation('Invalid invite id.');
      await db.delete(schema.invites).where(eq(schema.invites.id, id.data));
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
