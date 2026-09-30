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
}

export const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
