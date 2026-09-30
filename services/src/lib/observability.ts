import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';
import type { Context } from 'aws-lambda';

// Service name and metrics namespace come from POWERTOOLS_* env vars set in Terraform.
export const logger = new Logger();
export const tracer = new Tracer();
export const metrics = new Metrics();

/** Adds Lambda context to logs, records cold starts, and always flushes metrics. */
export function instrument<E, R>(fn: (event: E, context: Context) => Promise<R>) {
  return async (event: E, context: Context): Promise<R> => {
    logger.addContext(context);
    metrics.captureColdStartMetric();
    try {
      return await fn(event, context);
    } finally {
      metrics.publishStoredMetrics();
    }
  };
}
