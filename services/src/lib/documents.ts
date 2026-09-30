import type { ExtractionResult } from '../extractors/types.ts';

export type DocumentStatus = 'UPLOADING' | 'PROCESSING' | 'NEEDS_REVIEW' | 'ACTIVE' | 'FAILED';

export const ALLOWED_CONTENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface StoredExtraction extends ExtractionResult {
  extractor: string;
}

/** A document as returned by the API (DynamoDB keys stripped). */
export interface DocumentRecord {
  workspaceId: string;
  docId: string;
  filename: string;
  contentType: AllowedContentType;
  size: number;
  s3Key: string;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
  extraction?: StoredExtraction;
  extractedAt?: string;
  error?: string;
}

export interface DocumentItem extends DocumentRecord {
  PK: string;
  SK: string;
}

export const workspacePk = (workspaceId: string) => `WS#${workspaceId}`;
export const documentSk = (docId: string) => `DOC#${docId}`;
export const DOCUMENT_SK_PREFIX = 'DOC#';

/** S3 key layout: ws/<workspaceId>/<docId>/<safe filename>. The extract Lambda parses it back. */
export function documentS3Key(workspaceId: string, docId: string, filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-100) || 'document';
  return `ws/${workspaceId}/${docId}/${safe}`;
}

const S3_KEY = /^ws\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/(.+)$/;

export function parseDocumentS3Key(key: string): { workspaceId: string; docId: string; filename: string } | null {
  const match = S3_KEY.exec(key);
  if (!match) return null;
  return { workspaceId: match[1]!, docId: match[2]!, filename: match[3]! };
}

export function toRecord(item: DocumentItem): DocumentRecord {
  const { PK: _pk, SK: _sk, ...record } = item;
  return record;
}
