import { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { docUrgency, formatBytes, formatDate, isInFlight } from '../lib/format';
import { APP_HOME, linkHandler } from '../lib/router';
import type { DocumentRecord } from '../lib/types';
import { Icon } from './Icon';
import { StatusBadge } from './StatusBadge';
import { ValidityTimeline } from './ValidityTimeline';

const DATE_LABEL = { issue: 'Issued', effective: 'Effective', expiry: 'Expires', renewal: 'Renewal' } as const;
const POLL_MS = 2000;

function Skeleton() {
  return (
    <div className="card skeleton-card" aria-hidden="true">
      <span className="skeleton" style={{ width: '40%' }} />
      <span className="skeleton" style={{ width: '90%' }} />
      <span className="skeleton" style={{ width: '70%' }} />
    </div>
  );
}

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
    <a className="back" href={APP_HOME} onClick={linkHandler(APP_HOME)}>
      <Icon name="back" size={16} />
      All documents
    </a>
  );

  if (error) {
    return (
      <div className="detail">
        {back}
        <p className="notice notice-error">
          <Icon name="alert" size={16} />
          {error}
        </p>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="detail">
        {back}
        <Skeleton />
      </div>
    );
  }

  const x = doc.extraction;
  return (
    <div className="detail">
      {back}

      <header className={`detail-head tone-${docUrgency(doc)}`}>
        <span className="doc-icon doc-icon-lg">
          <Icon name="file" size={24} />
        </span>
        <div className="detail-title">
          {x && <p className="eyebrow">{x.documentType}</p>}
          <h1>{x?.title ?? doc.filename}</h1>
          <p className="muted small">
            {doc.filename} · {formatBytes(doc.size)} · uploaded {formatDate(doc.createdAt)}
          </p>
        </div>
        <StatusBadge status={doc.status} />
      </header>

      {doc.status === 'FAILED' && (
        <p className="notice notice-error">
          <Icon name="alert" size={16} />
          Extraction failed: {doc.error ?? 'unknown error'}
        </p>
      )}
      {isInFlight(doc.status) && (
        <>
          <p className="notice">
            <span className="spinner spinner-sm" />
            Reading the document. This usually takes a few seconds.
          </p>
          <Skeleton />
        </>
      )}
      {doc.status === 'NEEDS_REVIEW' && (
        <p className="notice notice-brand">
          <Icon name="eye" size={16} />
          Check these details against the document. Confirming them and scheduling reminders comes next.
        </p>
      )}

      {x && (
        <>
          <ValidityTimeline dates={x.dates} />

          <div className="detail-grid">
            <section className="card">
              <h2>Details</h2>
              <dl className="fields">
                <dt>Type</dt>
                <dd>{x.documentType}</dd>
                <dt>Issuer</dt>
                <dd>{x.issuer ?? <span className="muted">Not found</span>}</dd>
                <dt>Parties</dt>
                <dd>
                  {x.parties.length ? (
                    <ul className="parties">
                      {x.parties.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="muted">None found</span>
                  )}
                </dd>
                {x.validityPeriod && (
                  <>
                    <dt>Validity</dt>
                    <dd>
                      <code>{x.validityPeriod}</code>
                    </dd>
                  </>
                )}
                {x.notes && (
                  <>
                    <dt>Notes</dt>
                    <dd>{x.notes}</dd>
                  </>
                )}
              </dl>
            </section>

            <section className="card">
              <h2>Dates found</h2>
              {x.dates.length === 0 ? (
                <p className="muted">No dates found. You’ll be able to add them during review.</p>
              ) : (
                <ul className="dates">
                  {x.dates.map((d) => (
                    <li key={`${d.label}-${d.isoDate}`} className={`date-row date-${d.label}`}>
                      <div className="date-top">
                        <span className="date-label">{DATE_LABEL[d.label]}</span>
                        <span className="date-value">{formatDate(d.isoDate)}</span>
                        <span className="confidence" title="Extraction confidence">
                          <span className="meter">
                            <span className="meter-fill" style={{ width: `${Math.round(d.confidence * 100)}%` }} />
                          </span>
                          {Math.round(d.confidence * 100)}%
                        </span>
                      </div>
                      <p className={`evidence${d.computed ? ' evidence-computed' : ''}`}>
                        <Icon name={d.computed ? 'clock' : 'quote'} size={14} />
                        {d.evidence}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <p className="muted small footnote">Extracted by the {x.extractor} extractor.</p>
        </>
      )}
    </div>
  );
}
