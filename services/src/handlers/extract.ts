import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { S3Event, S3EventRecord } from 'aws-lambda';
import { getExtractor, normalizeExtraction } from '../extractors/index.ts';
import { ddb, requireEnv } from '../lib/aws.ts';
import { MAX_UPLOAD_BYTES, documentSk, parseDocumentS3Key, workspacePk, type StoredExtraction } from '../lib/documents.ts';
import { instrument, logger, metrics } from '../lib/observability.ts';

const TABLE_NAME = requireEnv('TABLE_NAME');
const extractor = getExtractor();

type Key = { PK: string; SK: string };

/** Sets fields on an existing document. Returns false if the document doesn't exist. */
async function updateDocument(key: Key, fields: Record<string, unknown>, remove: string[] = []): Promise<boolean> {
  const entries = Object.entries(fields);
  const set = entries.map((_, i) => `#f${i} = :v${i}`).join(', ');
  const names = Object.fromEntries([
    ...entries.map(([name], i) => [`#f${i}`, name]),
    ...remove.map((name, i) => [`#r${i}`, name]),
  ]);
  const values = Object.fromEntries(entries.map(([, value], i) => [`:v${i}`, value]));
  const removeClause = remove.length ? ` REMOVE ${remove.map((_, i) => `#r${i}`).join(', ')}` : '';

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: key,
        UpdateExpression: `SET ${set}${removeClause}`,
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

async function processRecord(record: S3EventRecord): Promise<void> {
  const bucket = record.s3.bucket.name;
  const s3Key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
  const parsed = parseDocumentS3Key(s3Key);
  if (!parsed) {
    logger.warn('ignoring object with unexpected key', { s3Key });
    return;
  }

  const { workspaceId, docId } = parsed;
  const key = { PK: workspacePk(workspaceId), SK: documentSk(docId) };
  logger.appendKeys({ workspaceId, docId });

  try {
    // Presigned PUTs can't enforce a size limit, so check what actually arrived.
    if (record.s3.object.size > MAX_UPLOAD_BYTES) {
      throw new Error(`File is ${record.s3.object.size} bytes; the limit is ${MAX_UPLOAD_BYTES}`);
    }

    const exists = await updateDocument(key, { status: 'PROCESSING', updatedAt: new Date().toISOString() });
    if (!exists) {
      logger.warn('no document record for uploaded object', { s3Key });
      return;
    }

    const started = Date.now();
    const result = normalizeExtraction(await extractor.extract(bucket, s3Key));
    const latencyMs = Date.now() - started;

    const extraction: StoredExtraction = { ...result, extractor: extractor.name };
    const now = new Date().toISOString();
    await updateDocument(key, { status: 'NEEDS_REVIEW', extraction, extractedAt: now, updatedAt: now }, ['error']);

    metrics.addMetric('DocumentsProcessed', MetricUnit.Count, 1);
    metrics.addMetric('ExtractionLatency', MetricUnit.Milliseconds, latencyMs);
    logger.info('extraction complete', {
      extractor: extractor.name,
      latencyMs,
      documentType: result.documentType,
      dates: result.dates.length,
    });
  } catch (err) {
    // Mark FAILED instead of throwing, so S3's async retries don't re-run a broken document.
    logger.error('extraction failed', err as Error);
    metrics.addMetric('ExtractionFailures', MetricUnit.Count, 1);
    await updateDocument(key, {
      status: 'FAILED',
      error: err instanceof Error ? err.message : 'Extraction failed',
      updatedAt: new Date().toISOString(),
    });
  } finally {
    logger.removeKeys(['workspaceId', 'docId']);
  }
}

/** S3 ObjectCreated (ws/ prefix) → run the configured extractor → NEEDS_REVIEW. */
export const handler = instrument(async (event: S3Event) => {
  for (const record of event.Records) {
    await processRecord(record);
  }
});
