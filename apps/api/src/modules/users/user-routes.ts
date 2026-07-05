import { Router } from 'express';
import { z } from 'zod';
import { desc } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import type { PanelUser } from '@reforger-panel/shared';
import { ROLES } from '@reforger-panel/shared';
import type { Db } from '../../db/client.js';
import { schema } from '../../db/client.js';
import { ApiError } from '../../lib/errors.js';
import { requireCapability } from '../auth/auth-middleware.js';

const roleBodySchema = z.object({ role: z.enum(ROLES as [string, ...string[]]) });

export function createUserRouter(db: Db): Router {
  const router = Router();

  router.use(requireCapability('users.manage', 'Only the owner can manage users.'));

  router.get('/', async (_req, res, next) => {
    try {
      const rows = await db.select().from(schema.users).orderBy(desc(schema.users.createdAt));
      const users: PanelUser[] = rows.map((user) => ({
        id: user.id,
        discordId: user.discordId,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      }));
      res.json({ users });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id/role', async (req, res, next) => {
    try {
      const id = z.string().uuid().safeParse(req.params.id);
      if (!id.success) throw ApiError.validation('Invalid user id.');
      const body = roleBodySchema.safeParse(req.body);
      if (!body.success) throw ApiError.validation('Invalid role.');
      if (req.user!.id === id.data) {
        throw ApiError.validation('You cannot change your own role.');
      }
      const [updated] = await db
        .update(schema.users)
        .set({ role: body.data.role as (typeof ROLES)[number] })
        .where(eq(schema.users.id, id.data))
        .returning();
      if (!updated) throw ApiError.notFound('User not found.');
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
