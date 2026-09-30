import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';

const logger = new Logger();

export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyResultV2> => {
  logger.addContext(context);
  logger.info('health check', { path: event.rawPath, sourceIp: event.requestContext.http.sourceIp });

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify({
      ok: true,
      service: 'lapse',
      time: new Date().toISOString(),
      requestId: context.awsRequestId,
    }),
  };
};
