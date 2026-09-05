import { Router } from 'express';
import { z } from 'zod';
import { WORKSHOP_SORTS } from '@reforger-panel/shared';
import { ApiError } from '../../lib/errors.js';
import { rateLimit } from '../../lib/rate-limit.js';
import { requireAuth } from '../auth/auth-middleware.js';
import type { WorkshopCache } from './workshop-cache.js';

const searchQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  sort: z.enum(WORKSHOP_SORTS).optional(),
  // Upstream rejects comma-separated tags, so this is deliberately singular.
  tag: z
    .string()
    .trim()
    .max(40)
    .regex(/^[A-Za-z0-9 _-]*$/, 'Invalid tag.')
    .optional(),
  category: z
    .string()
    .trim()
    .max(40)
    .regex(/^[a-z0-9-]*$/, 'Invalid category.')
    .optional(),
});

const serverSearchQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).max(1_000).default(1),
});

const modIdSchema = z.string().regex(/^[A-Fa-f0-9]{16}$/, 'Invalid mod id.');
// reforgermods.net identifies servers by room UUID.
const serverIdSchema = z.string().regex(/^[A-Za-z0-9-]{8,64}$/, 'Invalid server id.');

export function createWorkshopRouter(workshop: WorkshopCache): Router {
  const router = Router();
  // The cache does the real upstream pacing; this only guards against a
  // runaway browser loop hammering our own API.
  const workshopRateLimit = rateLimit({ windowMs: 60_000, max: 240, keyPrefix: 'workshop' });

  router.use(requireAuth, workshopRateLimit);

  router.get('/search', async (req, res, next) => {
    try {
      const parsed = searchQuerySchema.safeParse(req.query);
      if (!parsed.success) throw ApiError.validation('Invalid search parameters.');
      const { q, page, sort, tag, category } = parsed.data;
      res.json(await workshop.search({ query: q, page, sort, tag, category }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/mods/:id', async (req, res, next) => {
    try {
      const parsed = modIdSchema.safeParse(req.params.id);
      if (!parsed.success) throw ApiError.validation('Invalid mod id.');
      res.json(await workshop.getMod(parsed.data));
    } catch (error) {
      next(error);
    }
  });

  router.get('/mods/:id/versions', async (req, res, next) => {
    try {
      const parsed = modIdSchema.safeParse(req.params.id);
      if (!parsed.success) throw ApiError.validation('Invalid mod id.');
      res.json(await workshop.getVersions(parsed.data));
    } catch (error) {
      next(error);
    }
  });

  /** Live server browser — backs "add a modlist based off another server". */
  router.get('/servers', async (req, res, next) => {
    try {
      const parsed = serverSearchQuerySchema.safeParse(req.query);
      if (!parsed.success) throw ApiError.validation('Invalid server search parameters.');
      res.json(await workshop.searchServers(parsed.data.q, parsed.data.page));
    } catch (error) {
      next(error);
    }
  });

  router.get('/servers/:id/mods', async (req, res, next) => {
    try {
      const parsed = serverIdSchema.safeParse(req.params.id);
      if (!parsed.success) throw ApiError.validation('Invalid server id.');
      res.json(await workshop.getServerMods(parsed.data));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
