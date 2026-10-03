import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { DeleteCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, requireEnv, s3 } from '../lib/aws.ts';
import { NOTIFICATION_SK_PREFIX, documentSk, workspacePk, type DocumentItem } from '../lib/documents.ts';
import { HttpError, apiHandler, isUuid, json } from '../lib/http.ts';
import { logger, metrics } from '../lib/observability.ts';
import { scheduleName } from '../lib/reminders.ts';
import { deleteReminderSchedule } from '../lib/schedules.ts';
import { getCaller } from '../lib/session.ts';

const TABLE_NAME = requireEnv('TABLE_NAME');
const UPLOAD_BUCKET = requireEnv('UPLOAD_BUCKET');

/** This document's entries in the workspace's reminder history. */
async function notificationKeys(pk: string, docId: string): Promise<{ PK: string; SK: string }[]> {
  const keys: { PK: string; SK: string }[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :notif)',
        FilterExpression: 'docId = :doc',
        ExpressionAttributeValues: { ':pk': pk, ':notif': NOTIFICATION_SK_PREFIX, ':doc': docId },
        ProjectionExpression: 'PK, SK',
        ExclusiveStartKey,
      }),
    );
    keys.push(...((page.Items ?? []) as { PK: string; SK: string }[]));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return keys;
}

/**
 * DELETE /api/documents/{id} → removes the document for good: pending reminders first (so none
 * can fire), then the file, its reminder history, and finally the record. Safe to retry.
 */
export const handler = apiHandler(async (event) => {
  const { workspaceId } = await getCaller(event);
  const docId = event.pathParameters?.id;
  if (!isUuid(docId)) throw new HttpError(400, 'Invalid document id');

  const pk = workspacePk(workspaceId);
  const key = { PK: pk, SK: documentSk(docId) };
  const { Item } = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: key }));
  const doc = Item as DocumentItem | undefined;
  if (!doc) throw new HttpError(404, 'Document not found');

  const schedules = [...(doc.reminders ?? []).map((r) => r.scheduleName), scheduleName(docId, 'test')];
  await Promise.all(schedules.map(deleteReminderSchedule));
  await s3.send(new DeleteObjectCommand({ Bucket: UPLOAD_BUCKET, Key: doc.s3Key }));
  const history = await notificationKeys(pk, docId);
  for (const k of history) await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: k }));
  // A mid-extraction document can't be resurrected: the extractor only updates existing records.
  await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: key }));

  metrics.addMetric('DocumentsDeleted', MetricUnit.Count, 1);
  logger.info('document deleted', { workspaceId, docId, schedules: schedules.length, notifications: history.length });
  return json(200, { deleted: true });
});
