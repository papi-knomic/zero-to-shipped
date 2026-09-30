import { daysUntil, describeDaysUntil, expiryDate, formatDate } from '../lib/format';
import { linkHandler } from '../lib/router';
import type { DocumentRecord } from '../lib/types';
import { StatusBadge } from './StatusBadge';

function Expiry({ doc }: { doc: DocumentRecord }) {
  const expiry = expiryDate(doc);
  if (!expiry) return <span className="muted">—</span>;
  const days = daysUntil(expiry);
  const urgency = days < 0 ? 'expired' : days <= 7 ? 'urgent' : days <= 30 ? 'soon' : days <= 60 ? 'upcoming' : 'ok';
  return (
    <span className="expiry">
      <span>{formatDate(expiry)}</span>
      <span className={`days days-${urgency}`}>{describeDaysUntil(days)}</span>
    </span>
  );
}

export function DocumentList({ documents }: { documents: DocumentRecord[] }) {
  if (documents.length === 0) {
    return (
      <section className="empty" aria-label="Documents">
        <p className="empty-title">No documents yet</p>
        <p className="empty-body">Upload a licence, policy, permit or contract to get started.</p>
      </section>
    );
  }

  return (
    <ul className="doc-list" aria-label="Documents">
      {documents.map((doc) => {
        const path = `/documents/${doc.docId}`;
        return (
          <li key={doc.docId}>
            <a className="doc-row" href={path} onClick={linkHandler(path)}>
              <span className="doc-main">
                <span className="doc-title">{doc.extraction?.title ?? doc.filename}</span>
                <span className="doc-meta">
                  {doc.extraction ? `${doc.extraction.documentType} · ${doc.extraction.issuer ?? 'Unknown issuer'}` : doc.filename}
                </span>
              </span>
              <Expiry doc={doc} />
              <StatusBadge status={doc.status} />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
