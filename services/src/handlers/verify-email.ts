import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { AlreadyExistsException, CreateEmailIdentityCommand } from '@aws-sdk/client-sesv2';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, requireEnv, ses } from '../lib/aws.ts';
import { workspacePk } from '../lib/documents.ts';
import { HttpError, apiHandler, getWorkspaceId, json, parseJsonBody } from '../lib/http.ts';
import { logger, metrics } from '../lib/observability.ts';
import { isEmail } from '../lib/reminders.ts';
import { recipientStatus } from '../lib/ses-identity.ts';

const TABLE_NAME = requireEnv('TABLE_NAME');
/** Each workspace may trigger only a few AWS verification emails, so this can't be used to spam. */
const MAX_VERIFICATIONS_PER_WORKSPACE = 3;

/**
 * POST /api/email/verify {email} → SES sandbox fallback: AWS emails the address a verification
 * link; once clicked, reminders can be delivered to it. A no-op with production access.
 */
export const handler = apiHandler(async (event) => {
  const workspaceId = getWorkspaceId(event);
  const { email: raw } = (parseJsonBody(event) ?? {}) as { email?: unknown };
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
  if (!isEmail(email)) throw new HttpError(400, 'email must be a valid email address');

  const current = await recipientStatus(email);
  if (current.status === 'deliverable') return json(200, { email, ...current });
  if (current.status === 'pending') {
    return json(200, { email, ...current, message: 'A verification email was already sent. Check your inbox and spam folder.' });
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: workspacePk(workspaceId), SK: 'LIMIT#EMAIL_VERIFY' },
        UpdateExpression: 'ADD verifyCount :one',
        ConditionExpression: 'attribute_not_exists(verifyCount) OR verifyCount < :max',
        ExpressionAttributeValues: { ':one': 1, ':max': MAX_VERIFICATIONS_PER_WORKSPACE },
      }),
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      throw new HttpError(429, 'This workspace has used all its verification emails.');
    }
    throw err;
  }

  try {
    await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: email }));
  } catch (err) {
    if (!(err instanceof AlreadyExistsException)) throw err;
  }

  metrics.addMetric('EmailVerificationsRequested', MetricUnit.Count, 1);
  logger.info('email verification requested', { workspaceId });
  return json(202, {
    email,
    status: 'pending',
    sandbox: true,
    message: 'AWS has sent a verification link to this address. Click it, then reminders can be delivered.',
  });
});
