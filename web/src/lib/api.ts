import type { ConfirmedFields, DocumentRecord, NotificationRecord, RecipientStatus } from './types';

// Empty (same origin) when the API serves the site or in dev (Vite proxies /api). On CloudFront
// the build bakes in the API URL, and the API's CORS allows only the CloudFront origin.
const API_URL = import.meta.env.VITE_API_URL ?? '';
const WORKSPACE_KEY = 'lapse.workspaceId';
let fallbackId: string | undefined;

/** Demo mode has no login: each browser gets its own workspace, kept in localStorage. */
export function getWorkspaceId(): string {
  // Dev only (stripped from production builds): ?workspace=<uuid> pins a workspace,
  // so headless screenshots can open a seeded one.
  if (import.meta.env.DEV) {
    const pinned = new URLSearchParams(window.location.search).get('workspace');
    if (pinned && /^[0-9a-f-]{36}$/.test(pinned)) return pinned;
  }
  try {
    const existing = localStorage.getItem(WORKSPACE_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(WORKSPACE_KEY, id);
    return id;
  } catch {
    // Storage blocked (private mode etc.): fall back to a per-tab workspace.
    return (fallbackId ??= crypto.randomUUID());
  }
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-workspace-id': getWorkspaceId(), ...init.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  health: () => request<{ ok: boolean }>('/api/health'),
  listDocuments: () => request<{ documents: DocumentRecord[] }>('/api/documents').then((r) => r.documents),
  getDocument: (id: string) =>
    request<{ document: DocumentRecord }>(`/api/documents/${encodeURIComponent(id)}`).then((r) => r.document),

  /** Creates the document record, then PUTs the file straight to S3 with the presigned URL. */
  async uploadDocument(file: File): Promise<DocumentRecord> {
    const { document, upload } = await request<{
      document: DocumentRecord;
      upload: { method: 'PUT'; url: string; headers: Record<string, string> };
    }>('/api/uploads', {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
    });

    const put = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: file });
    if (!put.ok) throw new ApiError(put.status, `Upload to storage failed (${put.status})`);
    return document;
  },

  /** Saves reviewed fields and (re)schedules reminders. reminderEmail null = stop reminders. */
  confirmDocument: (id: string, fields: ConfirmedFields, reminderEmail: string | null) =>
    request<{ document: DocumentRecord }>(`/api/documents/${encodeURIComponent(id)}/confirm`, {
      method: 'PUT',
      body: JSON.stringify({ ...fields, reminderEmail }),
    }).then((r) => r.document),

  sendTestReminder: (id: string) =>
    request<{ scheduledFor: string; email: string }>(`/api/documents/${encodeURIComponent(id)}/test-reminder`, {
      method: 'POST',
    }),

  listNotifications: () =>
    request<{ notifications: NotificationRecord[] }>('/api/notifications').then((r) => r.notifications),

  emailStatus: (email: string) => request<RecipientStatus>(`/api/email/status?email=${encodeURIComponent(email)}`),

  verifyEmail: (email: string) =>
    request<RecipientStatus>('/api/email/verify', { method: 'POST', body: JSON.stringify({ email }) }),
};
