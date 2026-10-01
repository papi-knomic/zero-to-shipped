import { useCallback, useEffect, useState } from 'react';
import { DocumentDetail } from './components/DocumentDetail';
import { DocumentList } from './components/DocumentList';
import { NotificationsFeed } from './components/NotificationsFeed';
import { SampleLoader } from './components/SampleLoader';
import { Icon, LogoMark } from './components/Icon';
import { StatsBar } from './components/StatsBar';
import { UploadDropzone } from './components/UploadDropzone';
import { api } from './lib/api';
import { isInFlight } from './lib/format';
import { useRoute } from './lib/router';
import type { DocumentRecord, NotificationRecord } from './lib/types';

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
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Demo workspace</p>
          <h1>
            Your renewals, <span className="accent">handled.</span>
          </h1>
          <p className="lede">
            Drop in a licence, contract, insurance policy, permit or certification. Lapse reads the
            dates for you. This workspace is private to your browser.
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

      {documents && documents.length === 0 && <SampleLoader onChange={refresh} />}

      {documents && documents.length > 0 && <StatsBar documents={documents} />}

      <section className="documents">
        <div className="section-head">
          <h2>Your documents</h2>
          {documents && documents.length > 0 && (
            <span className="section-tools">
              <span className="muted small">Soonest expiry first</span>
              <SampleLoader onChange={refresh} compact />
            </span>
          )}
        </div>
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

export function App() {
  const apiStatus = useApiHealth();
  const route = useRoute();

  return (
    <div className="shell">
      <header className="nav">
        <a className="brand" href="/" title="About Lapse">
          <LogoMark />
          <span className="wordmark">Lapse</span>
        </a>
        <span className={`conn conn-${apiStatus}`} role="status" title={`API ${API_STATUS_LABEL[apiStatus].toLowerCase()}`}>
          <span className="conn-dot" aria-hidden="true" />
          {API_STATUS_LABEL[apiStatus]}
        </span>
      </header>

      <main className="content">{route.name === 'document' ? <DocumentDetail id={route.id} /> : <DocumentsPage />}</main>

      <footer className="footer">Lapse · built for AWS Zero to Shipped</footer>
    </div>
  );
}
