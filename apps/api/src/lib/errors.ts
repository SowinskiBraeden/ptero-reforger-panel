import type { ApiErrorCode } from '@reforger-panel/shared';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  UPSTREAM_UNAVAILABLE: 502,
  NOT_CONFIGURED: 503,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }

  static unauthenticated(message = 'You must be signed in.') {
    return new ApiError('UNAUTHENTICATED', message);
  }
  static forbidden(message = 'You do not have permission to perform this action.') {
    return new ApiError('FORBIDDEN', message);
  }
  static notFound(message = 'Not found.') {
    return new ApiError('NOT_FOUND', message);
  }
  static validation(message: string) {
    return new ApiError('VALIDATION_ERROR', message);
  }
  static rateLimited(message = 'Too many requests. Try again shortly.') {
    return new ApiError('RATE_LIMITED', message);
  }
  static upstream(message = 'An upstream service is unavailable.') {
    return new ApiError('UPSTREAM_UNAVAILABLE', message);
  }
  static notConfigured(message = 'This feature is not configured.') {
    return new ApiError('NOT_CONFIGURED', message);
  }
}
