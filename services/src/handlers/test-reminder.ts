import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, requireEnv } from '../lib/aws.ts';
import { documentSk, workspacePk, type DocumentItem } from '../lib/documents.ts';
import { HttpError, apiHandler, getWorkspaceId, isUuid, json } from '../lib/http.ts';
import { logger } from '../lib/observability.ts';
import { scheduleName } from '../lib/reminders.ts';
import { createReminderSchedule } from '../lib/schedules.ts';

const TABLE_NAME = requireEnv('TABLE_NAME');
const DELAY_MS = 2 * 60_000;

/** POST /api/documents/{id}/test-reminder → demo: one reminder, two minutes from now. */
export const handler = apiHandler(async (event) => {
  const workspaceId = getWorkspaceId(event);
  const docId = event.pathParameters?.id;
  if (!isUuid(docId)) throw new HttpError(400, 'Invalid document id');

  const key = { PK: workspacePk(workspaceId), SK: documentSk(docId) };
  const { Item } = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: key }));
  const doc = Item as DocumentItem | undefined;
  if (!doc) throw new HttpError(404, 'Document not found');
  if (doc.status !== 'ACTIVE' || !doc.reminderEmail) {
    throw new HttpError(409, 'Confirm the document with a reminder email first.');
  }

  // Whole seconds, since at() expressions have second precision.
  const at = new Date(Math.ceil((Date.now() + DELAY_MS) / 1000) * 1000);
  const result = await createReminderSchedule(scheduleName(docId, 'test'), at, {
    workspaceId,
    docId,
    offsetDays: null,
    test: true,
  });
  // The schedule deletes itself after firing, so 'exists' means one is still pending.
  if (result === 'exists') throw new HttpError(409, 'A test reminder is already on its way. Check Reminder activity shortly.');

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: key,
      UpdateExpression: 'SET testReminderAt = :at',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: { ':at': at.toISOString() },
    }),
  );

  logger.info('test reminder scheduled', { workspaceId, docId, at: at.toISOString() });
  return json(202, { scheduledFor: at.toISOString(), email: doc.reminderEmail });
});
