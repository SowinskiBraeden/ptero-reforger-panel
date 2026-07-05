import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_OAUTH_AUTHORIZE = 'https://discord.com/oauth2/authorize';

const tokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
});

const discordUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  global_name: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
});

export type DiscordProfile = {
  discordId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type DiscordOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function buildAuthorizeUrl(config: DiscordOAuthConfig, state: string): string {
  const url = new URL(DISCORD_OAUTH_AUTHORIZE);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'none');
  return url.toString();
}

export async function exchangeCodeForProfile(
  config: DiscordOAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordProfile> {
  const tokenResponse = await fetchImpl(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) {
    throw ApiError.upstream('Discord token exchange failed.');
  }
  const token = tokenResponseSchema.parse(await tokenResponse.json());

  const userResponse = await fetchImpl(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `${token.token_type} ${token.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!userResponse.ok) {
    throw ApiError.upstream('Failed to fetch Discord profile.');
  }
  const user = discordUserSchema.parse(await userResponse.json());

  return {
    discordId: user.id,
    username: user.username,
    displayName: user.global_name ?? null,
    avatarUrl: user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
      : null,
  };
}
