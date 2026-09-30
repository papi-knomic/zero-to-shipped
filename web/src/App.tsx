import { useCallback, useEffect, useState } from 'react';
import { DocumentDetail } from './components/DocumentDetail';
import { DocumentList } from './components/DocumentList';
import { UploadDropzone } from './components/UploadDropzone';
import { api } from './lib/api';
import { isInFlight } from './lib/format';
import { linkHandler, useRoute } from './lib/router';
import type { DocumentRecord } from './lib/types';

type ApiStatus = 'checking' | 'healthy' | 'unreachable';
const POLL_MS = 2000;

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
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      try {
        const docs = await api.listDocuments();
        if (cancelled) return;
        setDocuments(docs);
        setError(null);
        // Keep polling while anything is uploading or being read.
        if (docs.some((d) => isInFlight(d.status))) timer = window.setTimeout(load, POLL_MS);
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
      <h1>Never miss a renewal.</h1>
      <p className="lede">
        Upload a licence, contract, insurance policy, permit or certification. Lapse reads the dates
        for you, you confirm them, and it emails reminders 60, 30 and 7 days before anything
        expires.
      </p>
      <UploadDropzone onUploaded={refresh} />
      {error && <p className="error">{error}</p>}
      {documents === null && !error ? <p className="muted">Loading documents…</p> : documents && <DocumentList documents={documents} />}
    </>
  );
}

export function App() {
  const apiStatus = useApiHealth();
  const route = useRoute();

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/" onClick={linkHandler('/')}>
          <span className="logo" aria-hidden="true" />
          <span>Lapse</span>
        </a>
        <span className={`badge badge-${apiStatus}`} role="status">
          API: {apiStatus}
        </span>
      </header>

      <main className="content">
        {route.name === 'document' ? <DocumentDetail id={route.id} /> : <DocumentsPage />}
      </main>
    </div>
  );
}
