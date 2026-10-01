// Mirrors services/src/lib/documents.ts and services/src/extractors/types.ts.

export type DocumentStatus = 'UPLOADING' | 'PROCESSING' | 'NEEDS_REVIEW' | 'ACTIVE' | 'FAILED';
export type DateLabel = 'issue' | 'effective' | 'expiry' | 'renewal';

export interface ExtractedDate {
  label: DateLabel;
  isoDate: string;
  evidence: string;
  confidence: number;
  computed?: boolean;
}

export interface Extraction {
  documentType: string;
  title: string;
  issuer: string | null;
  parties: string[];
  dates: ExtractedDate[];
  validityPeriod: string | null;
  notes: string | null;
  extractor: string;
}

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
  at: string;
  scheduleName: string;
}

export interface DocumentRecord {
  workspaceId: string;
  docId: string;
  filename: string;
  contentType: string;
  size: number;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
  extraction?: Extraction;
  extractedAt?: string;
  error?: string;
  confirmed?: ConfirmedFields;
  confirmedAt?: string;
  reminderEmail?: string | null;
  reminders?: ScheduledReminder[];
  testReminderAt?: string;
}

export type EmailStatus = 'SENT' | 'NOT_DELIVERED' | 'FAILED';

export interface NotificationRecord {
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

export interface RecipientStatus {
  email: string;
  status: 'deliverable' | 'pending' | 'unverified';
  sandbox: boolean;
  message?: string;
}

export const REMINDER_OFFSETS = [60, 30, 7] as const;

export const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
