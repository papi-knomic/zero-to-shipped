import { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { daysUntil, describeDaysUntil, formatBytes, formatDate, isInFlight } from '../lib/format';
import { linkHandler } from '../lib/router';
import type { DocumentRecord } from '../lib/types';
import { StatusBadge } from './StatusBadge';

const DATE_LABEL = { issue: 'Issued', effective: 'Effective', expiry: 'Expires', renewal: 'Renewal' } as const;
const POLL_MS = 2000;

export function DocumentDetail({ id }: { id: string }) {
  const [doc, setDoc] = useState<DocumentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      try {
        const next = await api.getDocument(id);
        if (cancelled) return;
        setDoc(next);
        setError(null);
        if (isInFlight(next.status)) timer = window.setTimeout(load, POLL_MS);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError && err.status === 404 ? 'Document not found.' : 'Could not load this document.');
      }
    };

    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [id]);

  const back = (
    <a className="back" href="/" onClick={linkHandler('/')}>
      ← All documents
    </a>
  );

  if (error) return <div className="detail">{back}<p className="error">{error}</p></div>;
  if (!doc) return <div className="detail">{back}<p className="muted">Loading…</p></div>;

  const x = doc.extraction;
  return (
    <div className="detail">
      {back}
      <header className="detail-head">
        <div>
          <h1>{x?.title ?? doc.filename}</h1>
          <p className="muted">
            {doc.filename} · {formatBytes(doc.size)} · uploaded {formatDate(doc.createdAt)}
          </p>
        </div>
        <StatusBadge status={doc.status} />
      </header>

      {doc.status === 'FAILED' && <p className="error">Extraction failed: {doc.error ?? 'unknown error'}</p>}
      {isInFlight(doc.status) && <p className="muted">Reading the document. This usually takes a few seconds…</p>}

      {x && (
        <>
          <dl className="fields">
            <dt>Type</dt>
            <dd>{x.documentType}</dd>
            <dt>Issuer</dt>
            <dd>{x.issuer ?? <span className="muted">Not found</span>}</dd>
            <dt>Parties</dt>
            <dd>{x.parties.length ? x.parties.join(', ') : <span className="muted">None found</span>}</dd>
            {x.validityPeriod && (
              <>
                <dt>Validity</dt>
                <dd>{x.validityPeriod}</dd>
              </>
            )}
            {x.notes && (
              <>
                <dt>Notes</dt>
                <dd>{x.notes}</dd>
              </>
            )}
          </dl>

          <h2>Dates</h2>
          {x.dates.length === 0 ? (
            <p className="muted">No dates found. You’ll be able to add them during review.</p>
          ) : (
            <ul className="dates">
              {x.dates.map((d) => (
                <li key={`${d.label}-${d.isoDate}`} className="date-card">
                  <div className="date-top">
                    <span className="date-label">{DATE_LABEL[d.label]}</span>
                    <span className="confidence" title="Extraction confidence">
                      {Math.round(d.confidence * 100)}%
                    </span>
                  </div>
                  <div className="date-value">{formatDate(d.isoDate)}</div>
                  {d.label === 'expiry' && <div className="muted">{describeDaysUntil(daysUntil(d.isoDate))}</div>}
                  <blockquote className={d.computed ? 'evidence evidence-computed' : 'evidence'}>{d.evidence}</blockquote>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">Extracted by: {x.extractor}. Confirming dates and scheduling reminders comes next.</p>
        </>
      )}
    </div>
  );
}
