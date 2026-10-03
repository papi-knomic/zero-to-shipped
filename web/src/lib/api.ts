import type { ConfirmedFields, DocumentRecord, NotificationRecord, RecipientStatus, User } from './types';

// Empty (same origin) when the API serves the site or in dev (Vite proxies /api). On CloudFront
// the build bakes in the API URL, and the API's CORS allows only the CloudFront origin.
const API_URL = import.meta.env.VITE_API_URL ?? '';
const WORKSPACE_KEY = 'lapse.workspaceId';
const DEMO_MODE_KEY = 'lapse.demo';
let fallbackId: string | undefined;
let demoModeFallback = false;

// Two ways in: a signed-in user (HttpOnly session cookies the browser sends by itself), or the
// no-login demo (a browser-generated ID in the x-workspace-id header). Demo mode lasts for the tab.

export function isDemoMode(): boolean {
  try {
    return sessionStorage.getItem(DEMO_MODE_KEY) === '1';
  } catch {
    return demoModeFallback;
  }
}

export function setDemoMode(on: boolean): void {
  demoModeFallback = on;
  try {
    if (on) sessionStorage.setItem(DEMO_MODE_KEY, '1');
    else sessionStorage.removeItem(DEMO_MODE_KEY);
  } catch {
    /* storage blocked: the in-memory flag still works for this page */
  }
}

/** This browser's demo workspace ID, if it has ever opened the demo (never creates one). */
export function existingDemoWorkspaceId(): string | null {
  try {
    return localStorage.getItem(WORKSPACE_KEY);
  } catch {
    return null;
  }
}

/** The demo workspace: one per browser, kept in localStorage. */
export function getDemoWorkspaceId(): string {
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
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Fired when the session can't be refreshed; the app sends the user to sign in. */
export const SIGNED_OUT_EVENT = 'lapse:signed-out';

/**
 * The account's Lambda concurrency is tiny (5) until AWS raises it, so bursts get throttled:
 * API Gateway answers 503/429 *without* running the function, which makes a retry safe.
 */
async function fetchWithRetry(url: string, init: RequestInit, attempts = 5): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, init);
    if ((res.status !== 503 && res.status !== 429) || i >= attempts - 1) return res;
    await new Promise((r) => setTimeout(r, 400 * 2 ** i + Math.random() * 200));
  }
}

let refreshing: Promise<boolean> | null = null;

/** The ID token lasts an hour; the refresh token (30 days) gets a new one. One refresh at a time. */
function refreshSession(): Promise<boolean> {
  refreshing ??= fetchWithRetry(`${API_URL}/api/auth/refresh`, { method: 'POST' })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

interface RequestOptions {
  /** Defaults to the tab's mode. */
  demo?: boolean;
  /** Sign-in calls report their own 401s instead of refreshing. */
  refresh?: boolean;
}

async function request<T>(path: string, init: RequestInit = {}, opts: RequestOptions = {}): Promise<T> {
  const demo = opts.demo ?? isDemoMode();
  const send = () =>
    fetchWithRetry(`${API_URL}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(demo ? { 'x-workspace-id': getDemoWorkspaceId() } : {}),
        ...init.headers,
      },
    });

  let res = await send();
  if (res.status === 401 && !demo && opts.refresh !== false) {
    if (await refreshSession()) res = await send();
    else window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  }

  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`, body.code);
  return body as T;
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const authCall = <T>(action: string, body: unknown) => request<T>(`/api/auth/${action}`, post(body), { demo: false, refresh: false });

export const auth = {
  /** The signed-in user, or an ApiError(401) if there's no session. */
  me: () => request<{ user: User }>('/api/auth/me', {}, { demo: false }).then((r) => r.user),
  signUp: (name: string, email: string, password: string) =>
    authCall<{ next: 'confirm' | 'signin' }>('signup', { name, email, password }),
  confirm: (email: string, code: string) => authCall<{ next: 'signin' }>('confirm', { email, code }),
  resendCode: (email: string) => authCall<{ ok: true }>('resend-code', { email }),
  signIn: (email: string, password: string) => authCall<{ user: User }>('signin', { email, password }).then((r) => r.user),
  signOut: () => authCall<{ ok: true }>('signout', {}),
  forgotPassword: (email: string) => authCall<{ ok: true }>('forgot-password', { email }),
  resetPassword: (email: string, code: string, password: string) =>
    authCall<{ next: 'signin' }>('reset-password', { email, code, password }),

  /** Documents waiting in this browser's demo workspace, for the "move them" offer. */
  demoDocuments: () => request<{ documents: DocumentRecord[] }>('/api/documents', {}, { demo: true }).then((r) => r.documents),
  claimDemo: (demoWorkspaceId: string) =>
    request<{ moved: number; skipped: number }>('/api/workspace/claim-demo', post({ demoWorkspaceId }), { demo: false }),
};

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

  /** A five-minute signed link to the original file. */
  documentFileUrl: (id: string) =>
    request<{ url: string }>(`/api/documents/${encodeURIComponent(id)}/file`).then((r) => r.url),

  deleteDocument: (id: string) => request<{ deleted: true }>(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' }),

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
