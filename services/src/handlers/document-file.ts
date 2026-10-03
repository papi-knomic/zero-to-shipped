import { GetObjectCommand } from '@aws-sdk/client-s3';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ddb, requireEnv, s3 } from '../lib/aws.ts';
import { documentSk, workspacePk, type DocumentItem } from '../lib/documents.ts';
import { HttpError, apiHandler, isUuid, json } from '../lib/http.ts';
import { getCaller } from '../lib/session.ts';

const TABLE_NAME = requireEnv('TABLE_NAME');
const UPLOAD_BUCKET = requireEnv('UPLOAD_BUCKET');
const URL_TTL_SECONDS = 300;

/**
 * GET /api/documents/{id}/file → a short-lived link to view the original upload. The bucket stays
 * private; the link is signed for this one object, for five minutes, and opens inline.
 */
export const handler = apiHandler(async (event) => {
  const { workspaceId } = await getCaller(event);
  const docId = event.pathParameters?.id;
  if (!isUuid(docId)) throw new HttpError(400, 'Invalid document id');

  const { Item } = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: workspacePk(workspaceId), SK: documentSk(docId) } }),
  );
  const doc = Item as DocumentItem | undefined;
  if (!doc) throw new HttpError(404, 'Document not found');
  if (doc.status === 'UPLOADING') throw new HttpError(409, 'The file is still uploading');

  const safeName = doc.filename.replace(/["\\\r\n]/g, '_');
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: UPLOAD_BUCKET,
      Key: doc.s3Key,
      ResponseContentType: doc.contentType,
      ResponseContentDisposition: `inline; filename="${safeName}"`,
      ResponseCacheControl: 'private, no-store',
    }),
    { expiresIn: URL_TTL_SECONDS },
  );
  return json(200, { url, expiresIn: URL_TTL_SECONDS });
});
