import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Context } from 'aws-lambda';
import { instrument, logger } from './observability.ts';

export type ApiResult = APIGatewayProxyStructuredResultV2;

export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function json(statusCode: number, body: unknown): ApiResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** Demo mode has no login: the browser generates a workspace UUID and sends it on every call. */
export function getWorkspaceId(event: APIGatewayProxyEventV2): string {
  const id = event.headers['x-workspace-id']?.toLowerCase();
  if (!isUuid(id)) throw new HttpError(400, 'Missing or invalid x-workspace-id header');
  return id;
}

export function parseJsonBody(event: APIGatewayProxyEventV2): unknown {
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
        logger.warn('request rejected', { statusCode: err.statusCode, reason: err.message });
        return json(err.statusCode, { error: err.message });
      }
      logger.error('unhandled error', err as Error);
      return json(500, { error: 'Internal error' });
    }
  });
}
