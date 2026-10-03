import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, requireEnv, s3 } from '../lib/aws.ts';
import {
  DOCUMENT_SK_PREFIX,
  NOTIFICATION_SK_PREFIX,
  workspacePk,
  type DocumentItem,
  type ScheduledReminder,
} from '../lib/documents.ts';
import { HttpError, apiHandler, isUuid, json, parseJsonBody } from '../lib/http.ts';
import { logger, metrics } from '../lib/observability.ts';
import { createReminderSchedule, deleteReminderSchedule } from '../lib/schedules.ts';
import { DEMO_PREFIX, getUser } from '../lib/session.ts';

const TABLE_NAME = requireEnv('TABLE_NAME');
const UPLOAD_BUCKET = requireEnv('UPLOAD_BUCKET');

type Item = Record<string, unknown> & { PK: string; SK: string };

async function demoItems(pk: string): Promise<Item[]> {
  const items: Item[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({ TableName: TABLE_NAME, KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': pk }, ExclusiveStartKey }),
    );
    items.push(...((page.Items ?? []) as Item[]));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/** Points future reminders at the account: schedule names stay the same, the payload changes. */
async function moveSchedules(reminders: ScheduledReminder[], workspaceId: string, docId: string): Promise<void> {
  const now = Date.now();
  for (const r of reminders) {
    if (Date.parse(r.at) <= now + 60_000) continue; // fired already (and deleted itself)
    await deleteReminderSchedule(r.scheduleName);
    await createReminderSchedule(r.scheduleName, new Date(r.at), { workspaceId, docId, offsetDays: r.offsetDays, test: false });
  }
}

/**
 * POST /api/workspace/claim-demo {demoWorkspaceId} → moves the documents (files, reminders,
 * activity) from a browser's demo workspace into the signed-in user's workspace. Holding the demo
 * ID is the proof of ownership, exactly as for the demo itself. Safe to retry: whatever is left
 * in the demo workspace is moved on the next call.
 */
export const handler = apiHandler(async (event) => {
  const user = await getUser(event);
  const { demoWorkspaceId } = (parseJsonBody(event) ?? {}) as { demoWorkspaceId?: unknown };
  const demoId = typeof demoWorkspaceId === 'string' ? demoWorkspaceId.toLowerCase() : demoWorkspaceId;
  if (!isUuid(demoId)) throw new HttpError(400, 'demoWorkspaceId must be the demo workspace UUID');

  const from = `${DEMO_PREFIX}${demoId}`;
  const to = user.workspaceId;
  const items = await demoItems(workspacePk(from));
  let moved = 0;
  let skipped = 0;

  for (const item of items) {
    if (item.SK.startsWith(DOCUMENT_SK_PREFIX)) {
      const doc = item as unknown as DocumentItem & { expiresAt?: number };
      // Mid-extraction documents would be written back to the demo workspace: leave them.
      if (doc.status === 'UPLOADING' || doc.status === 'PROCESSING') {
        skipped++;
        continue;
      }
      const s3Key = doc.s3Key.replace(`ws/${from}/`, `ws/${to}/`);
      const { expiresAt: _expires, testReminderAt: _test, ...rest } = doc;

      // Record first: when the copy's S3 event reaches the extractor, it finds a reviewed document and skips it.
      await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...rest, PK: workspacePk(to), workspaceId: to, s3Key } }));
      await s3.send(new CopyObjectCommand({ Bucket: UPLOAD_BUCKET, CopySource: `${UPLOAD_BUCKET}/${encodeURI(doc.s3Key)}`, Key: s3Key }));
      if (doc.status === 'ACTIVE' && doc.reminders?.length) await moveSchedules(doc.reminders, to, doc.docId);

      await s3.send(new DeleteObjectCommand({ Bucket: UPLOAD_BUCKET, Key: doc.s3Key }));
      await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: item.PK, SK: item.SK } }));
      moved++;
    } else if (item.SK.startsWith(NOTIFICATION_SK_PREFIX)) {
      const { expiresAt: _expires, ...rest } = item;
      await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...rest, PK: workspacePk(to), workspaceId: to } }));
      await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: item.PK, SK: item.SK } }));
    }
    // Anything else (the demo's verification-email counter) stays behind and expires with the demo.
  }

  metrics.addMetric('DemoDocumentsClaimed', MetricUnit.Count, moved);
  logger.info('demo workspace claimed', { userId: user.userId, moved, skipped });
  return json(200, { moved, skipped });
});
