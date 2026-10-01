import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, requireEnv } from '../lib/aws.ts';
import { NOTIFICATION_SK_PREFIX, workspacePk, type NotificationRecord } from '../lib/documents.ts';
import { apiHandler, getWorkspaceId, json } from '../lib/http.ts';

const TABLE_NAME = requireEnv('TABLE_NAME');

/** GET /api/notifications → the in-app reminder feed, newest first. */
export const handler = apiHandler(async (event) => {
  const workspaceId = getWorkspaceId(event);

  const { Items = [] } = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :notif)',
      ExpressionAttributeValues: { ':pk': workspacePk(workspaceId), ':notif': NOTIFICATION_SK_PREFIX },
      ScanIndexForward: false,
      Limit: 50,
    }),
  );

  const notifications = Items.map(({ PK: _pk, SK: _sk, ...n }) => n as NotificationRecord);
  return json(200, { notifications });
});
