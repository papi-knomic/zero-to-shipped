import { useCallback, useEffect, useState } from 'react';
import { AuthPage } from './components/AuthPage';
import { DocumentDetail } from './components/DocumentDetail';
import { DocumentList } from './components/DocumentList';
import { NotificationsFeed } from './components/NotificationsFeed';
import { SampleLoader } from './components/SampleLoader';
import { Icon, LogoMark } from './components/Icon';
import { StatsBar } from './components/StatsBar';
import { UploadDropzone } from './components/UploadDropzone';
import { ClaimDemoBanner, DemoBanner } from './components/WorkspaceBanners';
import { ApiError, SIGNED_OUT_EVENT, api, auth, isDemoMode, setDemoMode } from './lib/api';
import { isInFlight } from './lib/format';
import { APP_HOME, isAuthRoute, navigate, safeNext, useRoute } from './lib/router';
import { SessionContext, useSession, type Session } from './lib/session';
import type { DocumentRecord, NotificationRecord, User } from './lib/types';

type ApiStatus = 'checking' | 'healthy' | 'unreachable';
const POLL_MS = 2000;
const TEST_POLL_MS = 8000;
const API_STATUS_LABEL: Record<ApiStatus, string> = { checking: 'Connecting', healthy: 'Online', unreachable: 'Offline' };

function useApiHealth(): ApiStatus {
  const [status, setStatus] = useState<ApiStatus>('checking');
  useEffect(() => {
    api
      .health()
      .then((body) => setStatus(body.ok ? 'healthy' : 'unreachable'))
      .catch(() => setStatus('unreachable'));
  }, []);
  return status;
}

function DocumentsPage() {
  const session = useSession();
  const demo = session.mode === 'demo';
  const [documents, setDocuments] = useState<DocumentRecord[] | null>(null);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      try {
        const [docs, feed] = await Promise.all([api.listDocuments(), api.listNotifications().catch(() => null)]);
        if (cancelled) return;
        setDocuments(docs);
        if (feed) setNotifications(feed);
        setError(null);
        // Poll quickly while anything is being read, slowly while a test reminder is on its way.
        if (docs.some((d) => isInFlight(d.status))) timer = window.setTimeout(load, POLL_MS);
        else if (docs.some((d) => d.testReminderAt)) timer = window.setTimeout(load, TEST_POLL_MS);
      } catch {
        if (!cancelled) setError('Could not load documents. Is the API reachable?');
      }
    };

    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [version]);

  return (
    <>
      {session.mode === 'user' && <ClaimDemoBanner onMoved={refresh} />}

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">{demo ? 'Demo workspace' : 'Your workspace'}</p>
          <h1>
            Your renewals, <span className="accent">handled.</span>
          </h1>
          <p className="lede">
            Drop in a licence, contract, insurance policy, permit or certification. Lapse reads the
            dates for you.{' '}
            {demo ? 'This demo is private to your browser and deleted after 7 days.' : 'Only you can see these documents.'}
          </p>
          <ul className="hero-points">
            <li>
              <Icon name="check" size={16} />
              Finds issue, effective and expiry dates, with the quote it found them in
            </li>
            <li>
              <Icon name="check" size={16} />
              Nothing is scheduled until you confirm
            </li>
            <li>
              <Icon name="bell" size={16} />
              Email reminders at 60, 30 and 7 days
            </li>
          </ul>
        </div>
        <UploadDropzone onUploaded={refresh} />
      </section>

      {error && (
        <p className="notice notice-error">
          <Icon name="alert" size={16} />
          {error}
        </p>
      )}

      {/* Samples are fictional documents: demo only, never in a real account. */}
      {demo && documents && documents.length === 0 && <SampleLoader onChange={refresh} />}

      {documents && documents.length > 0 && <StatsBar documents={documents} />}

      <section className="documents">
        <div className="section-head">
          <h2>Your documents</h2>
          {documents && documents.length > 0 && (
            <span className="section-tools">
              <span className="muted small">Soonest expiry first</span>
              {demo && <SampleLoader onChange={refresh} compact />}
            </span>
          )}
        </div>
        {!demo && documents && documents.length === 0 && (
          <p className="muted empty-account">No documents yet. Upload your first licence, policy or permit above.</p>
        )}
        {documents === null && !error ? (
          <div className="card skeleton-card" aria-label="Loading documents">
            <span className="skeleton" style={{ width: '55%' }} />
            <span className="skeleton" style={{ width: '35%' }} />
          </div>
        ) : (
          documents && <DocumentList documents={documents} />
        )}
      </section>

      {documents && documents.length > 0 && (
        <section className="activity" id="activity">
          <div className="section-head">
            <h2>Reminder activity</h2>
            <span className="muted small">Every reminder appears here, even if the email can’t be delivered</span>
          </div>
          <div className="card">
            <NotificationsFeed notifications={notifications} />
          </div>
        </section>
      )}
    </>
  );
}

function AccountMenu({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <span className="account">
      <span className="account-email" title={user.email}>
        {user.name || user.email}
      </span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void auth.signOut().finally(onSignOut);
        }}
      >
        Sign out
      </button>
    </span>
  );
}

const signInPath = () => `/signin?next=${encodeURIComponent(window.location.pathname)}`;

export function App() {
  const apiStatus = useApiHealth();
  const route = useRoute();
  const [session, setSession] = useState<Session | 'loading'>('loading');

  // /demo switches this tab into the demo workspace, then shows the app.
  useEffect(() => {
    if (route.name !== 'demo') return;
    setDemoMode(true);
    setSession({ mode: 'demo' });
    navigate(APP_HOME, { replace: true });
  }, [route.name]);

  // Work out who's here: demo tab, signed-in user, or nobody (→ sign in).
  const authPage = isAuthRoute(route);
  useEffect(() => {
    if (route.name === 'demo') return;
    if (isDemoMode() && !authPage) {
      setSession({ mode: 'demo' });
      return;
    }
    let cancelled = false;
    auth
      .me()
      .then((user) => {
        if (cancelled) return;
        // Already signed in on a sign-in page: go straight to the app.
        if (authPage) navigate(safeNext(new URLSearchParams(window.location.search).get('next')), { replace: true });
        setSession({ mode: 'user', user });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          if (!authPage) navigate(signInPath(), { replace: true });
          setSession('loading');
        }
      });
    return () => {
      cancelled = true;
    };
    // Re-check only when moving between the app and the sign-in pages.
  }, [authPage, route.name]);

  // A session that can't be refreshed mid-use sends the user to sign in.
  useEffect(() => {
    const onSignedOut = () => {
      if (isDemoMode() || /^\/(signin|signup|forgot-password)\/?$/.test(window.location.pathname)) return;
      setSession('loading');
      navigate(signInPath(), { replace: true });
    };
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, []);

  if (authPage) {
    return (
      <div className="shell">
        <AuthPage
          route={route.name}
          onSignedIn={(user) => {
            setDemoMode(false);
            setSession({ mode: 'user', user });
            navigate(safeNext(new URLSearchParams(window.location.search).get('next')), { replace: true });
          }}
        />
      </div>
    );
  }

  if (session === 'loading') {
    return (
      <div className="shell">
        <div className="boot" aria-label="Loading">
          <span className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <SessionContext.Provider value={session}>
      <div className="shell">
        <header className="nav">
          <a className="brand" href="/" title="About Lapse">
            <LogoMark />
            <span className="wordmark">Lapse</span>
          </a>
          <span className="nav-right">
            <span className={`conn conn-${apiStatus}`} role="status" title={`API ${API_STATUS_LABEL[apiStatus].toLowerCase()}`}>
              <span className="conn-dot" aria-hidden="true" />
              {API_STATUS_LABEL[apiStatus]}
            </span>
            {session.mode === 'user' ? (
              <AccountMenu user={session.user} onSignOut={() => window.location.assign('/')} />
            ) : (
              <a className="btn btn-ghost btn-sm" href="/signin" onClick={() => setDemoMode(false)}>
                Sign in
              </a>
            )}
          </span>
        </header>

        {session.mode === 'demo' && <DemoBanner />}

        <main className="content">{route.name === 'document' ? <DocumentDetail id={route.id} /> : <DocumentsPage />}</main>

        <footer className="footer">Lapse · Reck Tech Ltd</footer>
      </div>
    </SessionContext.Provider>
  );
}
