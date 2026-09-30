import { useEffect, useState } from 'react';

// Deployed builds call the HTTP API directly (CORS allows only the CloudFront origin).
// Unset in dev, where Vite proxies relative /api requests.
const API_URL = import.meta.env.VITE_API_URL ?? '';

type ApiStatus = 'checking' | 'healthy' | 'unreachable';

function useApiHealth(): ApiStatus {
  const [status, setStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_URL}/api/health`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { ok?: boolean }) => setStatus(body.ok ? 'healthy' : 'unreachable'))
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setStatus('unreachable');
      });
    return () => controller.abort();
  }, []);

  return status;
}

export function App() {
  const api = useApiHealth();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          <span>Lapse</span>
        </div>
        <span className={`badge badge-${api}`} role="status">
          API: {api}
        </span>
      </header>

      <main className="content">
        <h1>Never miss a renewal.</h1>
        <p className="lede">
          Upload a licence, contract, insurance policy, permit or certification. Lapse reads the
          dates for you, you confirm them, and it emails reminders 60, 30 and 7 days before
          anything expires.
        </p>

        <section className="empty" aria-label="Documents">
          <p className="empty-title">No documents yet</p>
          <p className="empty-body">Uploading is coming in the next milestone.</p>
        </section>
      </main>
    </div>
  );
}
