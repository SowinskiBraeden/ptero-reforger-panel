import { pino } from 'pino';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.apiKey',
  '*.clientSecret',
  '*.sessionToken',
  '*.password',
  'apiKey',
  'clientSecret',
  'sessionToken',
];

export function createLogger(level?: string) {
  return pino({
    level: level ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    transport:
      process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
        : undefined,
  });
}

export type Logger = ReturnType<typeof createLogger>;

const SECRET_HINTS = [/api[_-]?key/i, /secret/i, /token/i, /password/i, /authorization/i];

/**
 * Strip anything that looks like a secret, an internal URL, or a stack trace
 * from an error before it is persisted or shown to a user.
 */
export function sanitizeErrorMessage(error: unknown, maxLength = 300): string {
  let message = error instanceof Error ? error.message : String(error);
  message = message.split('\n')[0] ?? '';
  // Drop credentials embedded in URLs and query strings.
  message = message.replace(/\/\/[^/\s:]+:[^@/\s]+@/g, '//[redacted]@');
  message = message.replace(/([?&](?:key|token|secret|password)=)[^&\s]+/gi, '$1[redacted]');
  for (const hint of SECRET_HINTS) {
    if (hint.test(message)) {
      // A secret-ish word appears; keep only a generic description.
      return 'Upstream request failed (details withheld — see server logs)';
    }
  }
  return message.slice(0, maxLength);
}
