import { randomUUID } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ddb, requireEnv, s3 } from '../lib/aws.ts';
import {
  ALLOWED_CONTENT_TYPES,
  MAX_UPLOAD_BYTES,
  documentS3Key,
  documentSk,
  toRecord,
  workspacePk,
  type AllowedContentType,
  type DocumentItem,
} from '../lib/documents.ts';
import { HttpError, apiHandler, json, parseJsonBody } from '../lib/http.ts';
import { logger } from '../lib/observability.ts';
import { demoExpiresAt, getCaller } from '../lib/session.ts';

const TABLE_NAME = requireEnv('TABLE_NAME');
const UPLOAD_BUCKET = requireEnv('UPLOAD_BUCKET');
const URL_TTL_SECONDS = 300;

interface CreateUploadRequest {
  filename: string;
  contentType: AllowedContentType;
  size: number;
}

function validate(body: unknown): CreateUploadRequest {
  const { filename, contentType, size } = (body ?? {}) as Record<string, unknown>;
  if (typeof filename !== 'string' || filename.trim().length === 0 || filename.length > 255) {
    throw new HttpError(400, 'filename must be a non-empty string of at most 255 characters');
  }
  if (!ALLOWED_CONTENT_TYPES.includes(contentType as AllowedContentType)) {
    throw new HttpError(415, `contentType must be one of: ${ALLOWED_CONTENT_TYPES.join(', ')}`);
  }
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, `size must be between 1 byte and ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  }
  return { filename: filename.trim(), contentType: contentType as AllowedContentType, size };
}

/** POST /api/uploads → creates the document record and returns a presigned S3 PUT URL. */
export const handler = apiHandler(async (event) => {
  const { workspaceId } = await getCaller(event);
  const req = validate(parseJsonBody(event));

  const docId = randomUUID();
  const now = new Date().toISOString();
  const expiresAt = demoExpiresAt(workspaceId);
  const item: DocumentItem & { expiresAt?: number } = {
    PK: workspacePk(workspaceId),
    SK: documentSk(docId),
    workspaceId,
    docId,
    filename: req.filename,
    contentType: req.contentType,
    size: req.size,
    s3Key: documentS3Key(workspaceId, docId, req.filename),
    status: 'UPLOADING',
    createdAt: now,
    updatedAt: now,
    ...(expiresAt ? { expiresAt } : {}),
  };

  await ddb.send(
    new PutCommand({ TableName: TABLE_NAME, Item: item, ConditionExpression: 'attribute_not_exists(PK)' }),
  );

  // Content-Type is signed, so the browser must PUT with exactly this type.
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: UPLOAD_BUCKET, Key: item.s3Key, ContentType: req.contentType }),
    { expiresIn: URL_TTL_SECONDS },
  );

  logger.info('upload created', { workspaceId, docId, contentType: req.contentType, size: req.size });

  return json(201, {
    document: toRecord(item),
    upload: { method: 'PUT', url, headers: { 'content-type': req.contentType }, expiresIn: URL_TTL_SECONDS },
  });
});
