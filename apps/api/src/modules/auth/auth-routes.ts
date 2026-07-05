import { Router } from 'express';
import { serialize as serializeCookie } from 'cookie';
import type { CurrentUser } from '@reforger-panel/shared';
import { ROLE_CAPABILITIES } from '@reforger-panel/shared';
import type { Env } from '../../env.js';
import { ApiError } from '../../lib/errors.js';
import { generateToken, signValue, verifySignedValue } from '../../lib/crypto.js';
import { rateLimit } from '../../lib/rate-limit.js';
import { buildAuthorizeUrl, exchangeCodeForProfile } from './discord.js';
import type { SessionService } from './session-service.js';
import { SESSION_COOKIE, requireAuth } from './auth-middleware.js';

const STATE_COOKIE = 'rp_oauth_state';

function sessionCookie(token: string, expiresAt: Date, secure: boolean): string {
  return serializeCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

function clearedSessionCookie(secure: boolean): string {
  return serializeCookie(SESSION_COOKIE, '', {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export function createAuthRouter(env: Env, sessions: SessionService): Router {
  const router = Router();
  const secure = env.NODE_ENV === 'production';
  const oauthConfig = {
    clientId: env.DISCORD_CLIENT_ID,
    clientSecret: env.DISCORD_CLIENT_SECRET,
    redirectUri: env.DISCORD_REDIRECT_URI,
  };
  const authRateLimit = rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'auth' });

  // Which login methods the frontend should offer.
  router.get('/options', (_req, res) => {
    res.json({
      discord: Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET),
      devLogin: env.DEV_AUTH_BYPASS && env.NODE_ENV !== 'production',
    });
  });

  router.get('/discord', authRateLimit, (req, res, next) => {
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
      next(
        ApiError.notConfigured(
          'Discord OAuth is not configured. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET.',
        ),
      );
      return;
    }
    const state = generateToken();
    res.setHeader(
      'Set-Cookie',
      serializeCookie(STATE_COOKIE, signValue(state, env.SESSION_SECRET), {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/api/auth',
        maxAge: 10 * 60,
      }),
    );
    res.redirect(buildAuthorizeUrl(oauthConfig, state));
  });

  router.get('/discord/callback', authRateLimit, async (req, res, next) => {
    try {
      const code = typeof req.query.code === 'string' ? req.query.code : null;
      const state = typeof req.query.state === 'string' ? req.query.state : null;
      const stateCookieRaw = req.headers.cookie
        ?.split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${STATE_COOKIE}=`))
        ?.slice(STATE_COOKIE.length + 1);

      if (!code || !state || !stateCookieRaw) {
        throw ApiError.validation('Missing OAuth code or state.');
      }
      const expectedState = verifySignedValue(
        decodeURIComponent(stateCookieRaw),
        env.SESSION_SECRET,
      );
      if (!expectedState || expectedState !== state) {
        throw ApiError.forbidden('OAuth state mismatch. Please try signing in again.');
      }

      const profile = await exchangeCodeForProfile(oauthConfig, code);
      const user = await sessions.upsertUserFromDiscord(profile);
      const session = await sessions.createSession(user.id);

      res.setHeader('Set-Cookie', [
        sessionCookie(session.token, session.expiresAt, secure),
        serializeCookie(STATE_COOKIE, '', { path: '/api/auth', maxAge: 0 }),
      ]);
      res.redirect(env.WEB_ORIGIN);
    } catch (error) {
      next(error);
    }
  });

  // Local development helper: sign in without Discord. Refuses to exist in
  // production (env validation also rejects the flag there).
  if (env.DEV_AUTH_BYPASS && env.NODE_ENV !== 'production') {
    router.post('/dev-login', authRateLimit, async (_req, res, next) => {
      try {
        const user = await sessions.upsertUserFromDiscord({
          discordId: env.OWNER_DISCORD_ID || '000000000000000000',
          username: 'dev-owner',
          displayName: 'Dev Owner',
          avatarUrl: null,
        });
        // The dev user is always the owner locally.
        if (user.role !== 'owner') {
          await sessions.setRole(user.id, 'owner');
        }
        const session = await sessions.createSession(user.id);
        res.setHeader('Set-Cookie', sessionCookie(session.token, session.expiresAt, secure));
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    });
  }

  router.get('/me', requireAuth, (req, res) => {
    const user = req.user!;
    const body: CurrentUser = {
      id: user.id,
      discordId: user.discordId,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      capabilities: [...ROLE_CAPABILITIES[user.role]],
    };
    res.json(body);
  });

  router.post('/logout', async (req, res, next) => {
    try {
      if (req.sessionToken) {
        await sessions.revokeSession(req.sessionToken);
      }
      res.setHeader('Set-Cookie', clearedSessionCookie(secure));
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
