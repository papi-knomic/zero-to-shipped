import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, requireEnv } from '../lib/aws.ts';
import { documentSk, toRecord, workspacePk, type DocumentItem } from '../lib/documents.ts';
import { HttpError, apiHandler, getWorkspaceId, isUuid, json } from '../lib/http.ts';

const TABLE_NAME = requireEnv('TABLE_NAME');

/** GET /api/documents/{id} → one document, scoped to the caller's workspace. */
export const handler = apiHandler(async (event) => {
  const workspaceId = getWorkspaceId(event);
  const docId = event.pathParameters?.id;
  if (!isUuid(docId)) throw new HttpError(400, 'Invalid document id');

  const { Item } = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: workspacePk(workspaceId), SK: documentSk(docId) } }),
  );
  if (!Item) throw new HttpError(404, 'Document not found');

  return json(200, { document: toRecord(Item as DocumentItem) });
});
