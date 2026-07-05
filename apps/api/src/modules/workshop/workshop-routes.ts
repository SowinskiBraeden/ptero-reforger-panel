import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { rateLimit } from '../../lib/rate-limit.js';
import { requireAuth } from '../auth/auth-middleware.js';
import type { WorkshopClient } from './workshop-client.js';

const searchQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  sort: z.enum(['popularity', 'newest', 'subscribers', 'version_size']).optional(),
});

const modIdSchema = z.string().regex(/^[A-Za-z0-9]{1,32}$/, 'Invalid mod id.');

export function createWorkshopRouter(client: WorkshopClient): Router {
  const router = Router();
  // The upstream allows 60 req/min per IP; stay well under it.
  const workshopRateLimit = rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'workshop' });

  router.use(requireAuth, workshopRateLimit);

  router.get('/health', async (_req, res, next) => {
    try {
      res.json(await client.health());
    } catch (error) {
      next(error);
    }
  });

  router.get('/search', async (req, res, next) => {
    try {
      const parsed = searchQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw ApiError.validation('Invalid search parameters.');
      }
      const { q, page, sort } = parsed.data;
      res.json(await client.search(q, page, sort));
    } catch (error) {
      next(error);
    }
  });

  router.get('/mods/:id', async (req, res, next) => {
    try {
      const parsed = modIdSchema.safeParse(req.params.id);
      if (!parsed.success) {
        throw ApiError.validation('Invalid mod id.');
      }
      res.json(await client.getMod(parsed.data));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
