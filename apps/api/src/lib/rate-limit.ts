import type { NextFunction, Request, Response } from 'express';
import { ApiError } from './errors.js';

type Bucket = { count: number; resetAt: number };

/**
 * Small in-memory fixed-window rate limiter. Sufficient for a single-process
 * private panel; swap for a shared store if the API is ever scaled out.
 */
export function rateLimit(options: { windowMs: number; max: number; keyPrefix: string }) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, _res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${options.keyPrefix}:${req.ip ?? 'unknown'}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) {
        if (b.resetAt <= now) buckets.delete(k);
      }
    }
    if (bucket.count > options.max) {
      next(ApiError.rateLimited());
      return;
    }
    next();
  };
}
