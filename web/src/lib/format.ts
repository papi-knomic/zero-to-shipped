import type { DocumentRecord, DocumentStatus } from './types';

/** YYYY-MM-DD → DD/MM/YYYY (matches the documents' own convention). */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function expiryDate(doc: DocumentRecord): string | undefined {
  return doc.extraction?.dates.find((d) => d.label === 'expiry')?.isoDate;
}

/** Whole days from today (UTC) to the given date; negative when past. */
export function daysUntil(isoDate: string): number {
  const today = new Date(new Date().toISOString().slice(0, 10));
  return Math.round((new Date(isoDate).getTime() - today.getTime()) / 86_400_000);
}

export function describeDaysUntil(days: number): string {
  if (days === 0) return 'Expires today';
  if (days < 0) return `Expired ${-days} day${days === -1 ? '' : 's'} ago`;
  return `${days} day${days === 1 ? '' : 's'} left`;
}

/** Urgency bands match the reminder schedule: 60, 30 and 7 days before expiry. */
export type Urgency = 'expired' | 'critical' | 'soon' | 'upcoming' | 'ok' | 'none';

export function urgency(days: number | undefined): Urgency {
  if (days === undefined) return 'none';
  if (days < 0) return 'expired';
  if (days <= 7) return 'critical';
  if (days <= 30) return 'soon';
  if (days <= 60) return 'upcoming';
  return 'ok';
}

export function docUrgency(doc: DocumentRecord): Urgency {
  const expiry = expiryDate(doc);
  return urgency(expiry ? daysUntil(expiry) : undefined);
}

/** In-flight first, then soonest expiry, then documents without an expiry date. */
export function byUrgency(a: DocumentRecord, b: DocumentRecord): number {
  const rank = (d: DocumentRecord) => {
    if (isInFlight(d.status)) return -Infinity;
    const e = expiryDate(d);
    return e ? daysUntil(e) : Infinity;
  };
  return rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt);
}

export const STATUS_LABEL: Record<DocumentStatus, string> = {
  UPLOADING: 'Uploading',
  PROCESSING: 'Reading document',
  NEEDS_REVIEW: 'Needs review',
  ACTIVE: 'Active',
  FAILED: 'Failed',
};

export const isInFlight = (status: DocumentStatus) => status === 'UPLOADING' || status === 'PROCESSING';
