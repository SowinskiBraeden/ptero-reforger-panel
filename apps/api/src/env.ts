import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    WEB_ORIGIN: z.string().url().default('http://localhost:5173'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    /** Directory of the built web app; when it exists the API serves it. */
    WEB_DIST_PATH: z.string().default(''),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

    DISCORD_CLIENT_ID: z.string().default(''),
    DISCORD_CLIENT_SECRET: z.string().default(''),
    DISCORD_REDIRECT_URI: z.string().default('http://localhost:3001/api/auth/discord/callback'),
    OWNER_DISCORD_ID: z.string().default(''),
    DEV_AUTH_BYPASS: booleanString,

    REFORGER_WORKSHOP_API_BASE_URL: z.string().url().default('https://api.reforgermods.net'),

    PTERODACTYL_BASE_URL: z.string().default(''),
    PTERODACTYL_CLIENT_API_KEY: z.string().default(''),
    PTERODACTYL_SERVER_ID: z.string().default(''),
    USE_MOCK_PTERODACTYL: booleanString,

    REFORGER_CONFIG_PATH: z.string().default('/config.json'),
    REFORGER_CONFIG_SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(60).max(86400).default(300),

    REFORGER_ADMIN_LOG_PATH: z.string().default(''),
    REFORGER_LOG_DIRECTORY: z.string().default(''),
    REFORGER_LOG_FILE_PATTERN: z.string().default(''),
    REFORGER_LOG_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3600).default(20),
    REFORGER_LOG_MAX_DOWNLOAD_BYTES: z.coerce
      .number()
      .int()
      .min(64 * 1024)
      .max(64 * 1024 * 1024)
      .default(2 * 1024 * 1024),
    REFORGER_LOG_STALE_AFTER_SECONDS: z.coerce.number().int().min(30).default(90),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.DEV_AUTH_BYPASS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DEV_AUTH_BYPASS must not be enabled in production',
        path: ['DEV_AUTH_BYPASS'],
      });
    }
    if (!env.USE_MOCK_PTERODACTYL) {
      for (const key of [
        'PTERODACTYL_BASE_URL',
        'PTERODACTYL_CLIENT_API_KEY',
        'PTERODACTYL_SERVER_ID',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${key} is required when USE_MOCK_PTERODACTYL is false`,
            path: [key],
          });
        }
      }
    }
    if (env.NODE_ENV === 'production' && (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Discord OAuth credentials are required in production',
        path: ['DISCORD_CLIENT_ID'],
      });
    }
    if (env.NODE_ENV === 'production' && !env.OWNER_DISCORD_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'OWNER_DISCORD_ID is required in production so the owner account is recoverable',
        path: ['OWNER_DISCORD_ID'],
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}

/** True when the panel has enough configuration to talk to a game server backend. */
export function isPterodactylConfigured(env: Env): boolean {
  return (
    env.USE_MOCK_PTERODACTYL ||
    Boolean(env.PTERODACTYL_BASE_URL && env.PTERODACTYL_CLIENT_API_KEY && env.PTERODACTYL_SERVER_ID)
  );
}
