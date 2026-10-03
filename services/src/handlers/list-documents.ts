import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, requireEnv } from '../lib/aws.ts';
import { DOCUMENT_SK_PREFIX, toRecord, workspacePk, type DocumentItem } from '../lib/documents.ts';
import { apiHandler, json } from '../lib/http.ts';
import { getCaller } from '../lib/session.ts';

const TABLE_NAME = requireEnv('TABLE_NAME');

/** GET /api/documents → all documents in the workspace, newest first. */
export const handler = apiHandler(async (event) => {
  const { workspaceId } = await getCaller(event);

  const items: DocumentItem[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :doc)',
        ExpressionAttributeValues: { ':pk': workspacePk(workspaceId), ':doc': DOCUMENT_SK_PREFIX },
        ExclusiveStartKey: cursor,
      }),
    );
    items.push(...((page.Items ?? []) as DocumentItem[]));
    cursor = page.LastEvaluatedKey;
  } while (cursor);

  const documents = items.map(toRecord).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return json(200, { documents });
});
