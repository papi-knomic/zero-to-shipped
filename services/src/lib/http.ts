import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Context } from 'aws-lambda';
import { instrument, logger } from './observability.ts';

export type ApiResult = APIGatewayProxyStructuredResultV2;

export class HttpError extends Error {
  readonly statusCode: number;
  /** Machine-readable reason the browser can act on (e.g. "session_expired"). */
  readonly code?: string;

  constructor(statusCode: number, message: string, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function json(statusCode: number, body: unknown, cookies?: string[]): ApiResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
    ...(cookies?.length ? { cookies } : {}),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function parseJsonBody(event: APIGatewayProxyEventV2): unknown {
  // Session cookies are SameSite=Lax; requiring JSON also rules out cross-site form posts.
  if (!/^application\/json\b/i.test(event.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  if (!event.body) throw new HttpError(400, 'Request body is required');
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
}

/** Wraps an API handler: observability, HttpError → status code, anything else → 500. */
export function apiHandler(fn: (event: APIGatewayProxyEventV2, context: Context) => Promise<ApiResult>) {
  return instrument(async (event: APIGatewayProxyEventV2, context: Context): Promise<ApiResult> => {
    try {
      return await fn(event, context);
    } catch (err) {
      if (err instanceof HttpError) {
        logger.warn('request rejected', { statusCode: err.statusCode, reason: err.message, code: err.code });
        return json(err.statusCode, { error: err.message, ...(err.code ? { code: err.code } : {}) });
      }
      logger.error('unhandled error', err as Error);
      return json(500, { error: 'Internal error' });
    }
  });
}
