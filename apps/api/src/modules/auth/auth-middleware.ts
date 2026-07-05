import type { NextFunction, Request, Response } from 'express';
import { parse as parseCookies } from 'cookie';
import type { Capability } from '@reforger-panel/shared';
import { roleHasCapability } from '@reforger-panel/shared';
import { ApiError } from '../../lib/errors.js';
import type { SessionUser } from './session-service.js';

export const SESSION_COOKIE = 'rp_session';

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
    sessionToken?: string;
  }
}

export interface SessionLookup {
  getUserBySessionToken(token: string): Promise<SessionUser | null>;
}

export function readSessionToken(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const cookies = parseCookies(header);
  return cookies[SESSION_COOKIE] ?? null;
}

/** Resolves the session cookie into req.user (if valid); never rejects on its own. */
export function sessionResolver(sessions: SessionLookup) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = readSessionToken(req);
      if (token) {
        const user = await sessions.getUserBySessionToken(token);
        if (user) {
          req.user = user;
          req.sessionToken = token;
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    next(ApiError.unauthenticated());
    return;
  }
  next();
}

/** Backend-enforced capability check. Frontend role checks are UI convenience only. */
export function requireCapability(capability: Capability, message?: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(ApiError.unauthenticated());
      return;
    }
    if (!roleHasCapability(req.user.role, capability)) {
      next(ApiError.forbidden(message));
      return;
    }
    next();
  };
}

/**
 * CSRF protection for state-changing endpoints: the SPA sends a custom header
 * (which browsers only allow same-origin / via CORS we control), and when the
 * browser supplies an Origin header it must match an allowed origin.
 */
export function csrfProtection(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins.map((o) => o.replace(/\/$/, '')));
  return (req: Request, _res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && !allowed.has(origin.replace(/\/$/, ''))) {
      next(ApiError.forbidden('Cross-origin request rejected.'));
      return;
    }
    if (req.headers['x-csrf-protection'] !== '1') {
      next(ApiError.forbidden('Missing CSRF protection header.'));
      return;
    }
    next();
  };
}
