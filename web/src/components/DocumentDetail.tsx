import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { docTitle, docUrgency, formatBytes, formatDate, isInFlight } from '../lib/format';
import { APP_HOME, linkHandler } from '../lib/router';
import type { DocumentRecord, ExtractedDate } from '../lib/types';
import { Icon } from './Icon';
import { RemindersCard } from './RemindersCard';
import { ReviewForm } from './ReviewForm';
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
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

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
  }, [id, version]);

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
  const c = doc.confirmed;
  // After review, the timeline follows the confirmed dates, not the extracted ones.
  const timelineDates: ExtractedDate[] = c
    ? [
        ...(c.issueDate ? [{ label: 'issue' as const, isoDate: c.issueDate, evidence: '', confidence: 1 }] : []),
        { label: 'expiry' as const, isoDate: c.expiryDate, evidence: '', confidence: 1 },
      ]
    : (x?.dates ?? []);
  const reviewing = doc.status === 'NEEDS_REVIEW' || doc.status === 'FAILED' || editing;
  const saved = (next: DocumentRecord) => {
    setDoc(next);
    setEditing(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="detail">
      {back}

      <header className={`detail-head tone-${docUrgency(doc)}`}>
        <span className="doc-icon doc-icon-lg">
          <Icon name="file" size={24} />
        </span>
        <div className="detail-title">
          {(c ?? x) && <p className="eyebrow">{(c ?? x)!.documentType}</p>}
          <h1>{docTitle(doc)}</h1>
          <p className="muted small">
            {doc.filename} · {formatBytes(doc.size)} · uploaded {formatDate(doc.createdAt)}
          </p>
        </div>
        <StatusBadge status={doc.status} />
      </header>

      {doc.status === 'FAILED' && (
        <p className="notice notice-error">
          <Icon name="alert" size={16} />
          Lapse couldn’t read this document ({doc.error ?? 'unknown error'}). You can enter the details yourself below.
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
      {reviewing && !isInFlight(doc.status) && (
        <ReviewForm key={doc.updatedAt} doc={doc} onSaved={saved} onCancel={editing ? () => setEditing(false) : undefined} />
      )}

      {doc.status === 'ACTIVE' && !editing && <RemindersCard doc={doc} onEdit={() => setEditing(true)} onChanged={reload} />}

      {(x || c) && <ValidityTimeline dates={timelineDates} />}

      {x && (
        <>
          <h2 className="section-label">{c ? 'Originally extracted' : 'What Lapse found'}</h2>

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
