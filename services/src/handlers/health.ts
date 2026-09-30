import { apiHandler, json } from '../lib/http.ts';
import { logger } from '../lib/observability.ts';

export const handler = apiHandler(async (event, context) => {
  logger.info('health check', { path: event.rawPath });
  return json(200, {
    ok: true,
    service: 'lapse',
    time: new Date().toISOString(),
    requestId: context.awsRequestId,
  });
});
