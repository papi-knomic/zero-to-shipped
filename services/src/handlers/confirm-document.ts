import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, requireEnv } from '../lib/aws.ts';
import { isIsoDate } from '../lib/dates.ts';
import {
  documentSk,
  toRecord,
  workspacePk,
  type ConfirmedFields,
  type DocumentItem,
  type ScheduledReminder,
} from '../lib/documents.ts';
import { HttpError, apiHandler, getWorkspaceId, isUuid, json, parseJsonBody } from '../lib/http.ts';
import { logger, metrics } from '../lib/observability.ts';
import { isEmail, reminderTimes, scheduleName } from '../lib/reminders.ts';
import { createReminderSchedule, deleteReminderSchedule } from '../lib/schedules.ts';

const TABLE_NAME = requireEnv('TABLE_NAME');

interface ConfirmRequest {
  fields: ConfirmedFields;
  /** null = keep the document but stop reminders. */
  reminderEmail: string | null;
}

function text(value: unknown, field: string, max: number, required: boolean): string | null {
  const v = typeof value === 'string' ? value.trim() : value;
  if (v === null || v === undefined || v === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  if (typeof v !== 'string' || v.length > max) throw new HttpError(400, `${field} must be text of at most ${max} characters`);
  return v;
}

function date(value: unknown, field: string, required: boolean): string | null {
  if (value === null || value === undefined || value === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  if (typeof value !== 'string' || !isIsoDate(value)) throw new HttpError(400, `${field} must be a date (YYYY-MM-DD)`);
  return value;
}

function validate(body: unknown): ConfirmRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const parties = b.parties ?? [];
  if (!Array.isArray(parties) || parties.length > 10 || parties.some((p) => typeof p !== 'string' || p.length > 200)) {
    throw new HttpError(400, 'parties must be a list of up to 10 names');
  }
  const reminderEmail = typeof b.reminderEmail === 'string' ? b.reminderEmail.trim().toLowerCase() : b.reminderEmail;
  if (reminderEmail !== null && !isEmail(reminderEmail)) {
    throw new HttpError(400, 'reminderEmail must be a valid email address, or null to stop reminders');
  }

  return {
    fields: {
      title: text(b.title, 'title', 200, true)!,
      documentType: text(b.documentType, 'documentType', 100, true)!,
      issuer: text(b.issuer, 'issuer', 200, false),
      parties: parties.map((p: string) => p.trim()).filter(Boolean),
      issueDate: date(b.issueDate, 'issueDate', false),
      expiryDate: date(b.expiryDate, 'expiryDate', true)!,
    },
    reminderEmail,
  };
}

/**
 * PUT /api/documents/{id}/confirm → saves the reviewed fields and (re)schedules reminders.
 * Existing schedules are always replaced, so editing the expiry date moves every reminder.
 */
export const handler = apiHandler(async (event) => {
  const workspaceId = getWorkspaceId(event);
  const docId = event.pathParameters?.id;
  if (!isUuid(docId)) throw new HttpError(400, 'Invalid document id');
  const req = validate(parseJsonBody(event));

  const key = { PK: workspacePk(workspaceId), SK: documentSk(docId) };
  const { Item } = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: key }));
  const doc = Item as DocumentItem | undefined;
  if (!doc) throw new HttpError(404, 'Document not found');
  // FAILED is allowed: if extraction failed, the user can still enter the details by hand.
  if (doc.status === 'UPLOADING' || doc.status === 'PROCESSING') {
    throw new HttpError(409, 'The document is still being read. Try again in a few seconds.');
  }

  // Replace, never merge: drop every schedule from the previous confirmation first.
  await Promise.all((doc.reminders ?? []).map((r) => deleteReminderSchedule(r.scheduleName)));

  const reminders: ScheduledReminder[] = [];
  if (req.reminderEmail) {
    for (const { offsetDays, at } of reminderTimes(req.fields.expiryDate)) {
      const name = scheduleName(docId, offsetDays);
      const payload = { workspaceId, docId, offsetDays, test: false };
      if ((await createReminderSchedule(name, at, payload)) === 'exists') {
        // Left over from an interrupted earlier confirm: replace it.
        await deleteReminderSchedule(name);
        await createReminderSchedule(name, at, payload);
      }
      reminders.push({ offsetDays, at: at.toISOString(), scheduleName: name });
    }
  }

  const now = new Date().toISOString();
  const { Attributes } = await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: key,
      UpdateExpression:
        'SET #status = :active, confirmed = :fields, reminderEmail = :email, reminders = :reminders, confirmedAt = :now, updatedAt = :now REMOVE #error',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
      ExpressionAttributeValues: {
        ':active': 'ACTIVE',
        ':fields': req.fields,
        ':email': req.reminderEmail,
        ':reminders': reminders,
        ':now': now,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );

  metrics.addMetric('DocumentsConfirmed', MetricUnit.Count, 1);
  metrics.addMetric('RemindersScheduled', MetricUnit.Count, reminders.length);
  logger.info('document confirmed', { workspaceId, docId, expiryDate: req.fields.expiryDate, reminders: reminders.length });

  return json(200, { document: toRecord(Attributes as DocumentItem) });
});
