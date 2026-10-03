import type { ExtractionResult } from '../extractors/types.ts';

export type DocumentStatus = 'UPLOADING' | 'PROCESSING' | 'NEEDS_REVIEW' | 'ACTIVE' | 'FAILED';

export const ALLOWED_CONTENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface StoredExtraction extends ExtractionResult {
  extractor: string;
}

/** What the user confirmed on review. Reminders are scheduled from these, not the extraction. */
export interface ConfirmedFields {
  title: string;
  documentType: string;
  issuer: string | null;
  parties: string[];
  issueDate: string | null;
  expiryDate: string;
}

export interface ScheduledReminder {
  offsetDays: number;
  /** ISO timestamp (UTC) the reminder fires. */
  at: string;
  scheduleName: string;
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
  confirmed?: ConfirmedFields;
  confirmedAt?: string;
  reminderEmail?: string;
  reminders?: ScheduledReminder[];
  /** Set while a demo "test reminder" is pending. */
  testReminderAt?: string;
}

export interface DocumentItem extends DocumentRecord {
  PK: string;
  SK: string;
}

export const workspacePk = (workspaceId: string) => `WS#${workspaceId}`;
export const documentSk = (docId: string) => `DOC#${docId}`;
export const DOCUMENT_SK_PREFIX = 'DOC#';
export const NOTIFICATION_SK_PREFIX = 'NOTIF#';
/** NOTIF#<sent at>#<docId>: sorts by time within the workspace. */
export const notificationSk = (sentAt: string, docId: string) => `${NOTIFICATION_SK_PREFIX}${sentAt}#${docId}`;

export type EmailStatus = 'SENT' | 'NOT_DELIVERED' | 'FAILED';

/** One reminder, as shown in the in-app feed (always written, whatever happened to the email). */
export interface NotificationRecord {
  workspaceId: string;
  docId: string;
  title: string;
  expiryDate: string;
  daysLeft: number;
  offsetDays: number | null;
  test: boolean;
  email: string;
  emailStatus: EmailStatus;
  emailDetail?: string;
  sentAt: string;
}

/** S3 key layout: ws/<workspaceId>/<docId>/<safe filename>. The extract Lambda parses it back. */
export function documentS3Key(workspaceId: string, docId: string, filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-100) || 'document';
  return `ws/${workspaceId}/${docId}/${safe}`;
}

// Workspace IDs are a user's Cognito sub, or demo-<uuid> for the no-login demo.
const S3_KEY = /^ws\/((?:demo-)?[0-9a-f-]{36})\/([0-9a-f-]{36})\/(.+)$/;

export function parseDocumentS3Key(key: string): { workspaceId: string; docId: string; filename: string } | null {
  const match = S3_KEY.exec(key);
  if (!match) return null;
  return { workspaceId: match[1]!, docId: match[2]!, filename: match[3]! };
}

export function toRecord(item: DocumentItem): DocumentRecord {
  const { PK: _pk, SK: _sk, ...record } = item;
  return record;
}
