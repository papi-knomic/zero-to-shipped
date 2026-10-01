import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { MessageRejected, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { ddb, requireEnv, ses } from '../lib/aws.ts';
import {
  documentSk,
  notificationSk,
  workspacePk,
  type DocumentItem,
  type EmailStatus,
  type NotificationRecord,
} from '../lib/documents.ts';
import { renderReminderEmail } from '../lib/email.ts';
import { instrument, logger, metrics } from '../lib/observability.ts';
import { daysUntil } from '../lib/reminders.ts';

const TABLE_NAME = requireEnv('TABLE_NAME');
const FROM_ADDRESS = requireEnv('FROM_ADDRESS');
const CONFIGURATION_SET = requireEnv('CONFIGURATION_SET');
const APP_URL = requireEnv('APP_URL');

/** Payload EventBridge Scheduler delivers (set by confirm-document / test-reminder). */
export interface ReminderEvent {
  workspaceId: string;
  docId: string;
  offsetDays: number | null;
  test: boolean;
}

async function sendEmail(to: string, content: ReturnType<typeof renderReminderEmail>): Promise<{ status: EmailStatus; detail?: string }> {
  try {
    const res = await ses.send(
      new SendEmailCommand({
        FromEmailAddress: `Lapse Reminders <${FROM_ADDRESS}>`,
        Destination: { ToAddresses: [to] },
        ConfigurationSetName: CONFIGURATION_SET,
        Content: {
          Simple: {
            Subject: { Data: content.subject, Charset: 'UTF-8' },
            Body: { Text: { Data: content.text, Charset: 'UTF-8' }, Html: { Data: content.html, Charset: 'UTF-8' } },
          },
        },
      }),
    );
    return { status: 'SENT', detail: res.MessageId };
  } catch (err) {
    // In the SES sandbox, unverified recipients are rejected. The in-app feed still gets it.
    if (err instanceof MessageRejected) return { status: 'NOT_DELIVERED', detail: err.message };
    logger.error('email send failed', err as Error);
    return { status: 'FAILED', detail: err instanceof Error ? err.message : 'unknown error' };
  }
}

export const handler = instrument(async (event: ReminderEvent) => {
  const { workspaceId, docId, offsetDays, test } = event;
  logger.appendKeys({ workspaceId, docId, offsetDays, test });

  const key = { PK: workspacePk(workspaceId), SK: documentSk(docId) };
  const { Item } = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: key }));
  const doc = Item as DocumentItem | undefined;

  if (!doc || doc.status !== 'ACTIVE' || !doc.confirmed || !doc.reminderEmail) {
    logger.warn('skipping reminder: document missing, not active or reminders off');
    return;
  }

  const { confirmed } = doc;
  const daysLeft = daysUntil(confirmed.expiryDate);
  const content = renderReminderEmail({
    title: confirmed.title,
    documentType: confirmed.documentType,
    issuer: confirmed.issuer,
    expiryDate: confirmed.expiryDate,
    daysLeft,
    documentUrl: `${APP_URL}/documents/${docId}`,
    test,
  });

  const email = await sendEmail(doc.reminderEmail, content);

  const sentAt = new Date().toISOString();
  const notification: NotificationRecord = {
    workspaceId,
    docId,
    title: confirmed.title,
    expiryDate: confirmed.expiryDate,
    daysLeft,
    offsetDays,
    test,
    email: doc.reminderEmail,
    emailStatus: email.status,
    emailDetail: email.detail,
    sentAt,
  };
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { PK: workspacePk(workspaceId), SK: notificationSk(sentAt, docId), ...notification },
    }),
  );

  if (test) {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: key,
        UpdateExpression: 'REMOVE testReminderAt',
        ConditionExpression: 'attribute_exists(PK)',
      }),
    ).catch((err) => logger.warn('could not clear testReminderAt', { error: String(err) }));
  }

  metrics.addMetric('RemindersSent', MetricUnit.Count, 1);
  metrics.addMetric(email.status === 'SENT' ? 'ReminderEmailsDelivered' : 'ReminderEmailsNotDelivered', MetricUnit.Count, 1);
  logger.info('reminder processed', { emailStatus: email.status, daysLeft });
});
