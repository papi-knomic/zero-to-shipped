import { byUrgency, daysUntil, describeDaysUntil, docUrgency, expiryDate, formatDate, isInFlight } from '../lib/format';
import { linkHandler } from '../lib/router';
import type { DocumentRecord } from '../lib/types';
import { Icon } from './Icon';
import { StatusBadge } from './StatusBadge';

function Expiry({ doc }: { doc: DocumentRecord }) {
  const expiry = expiryDate(doc);
  if (!expiry) return <span className="expiry muted">{isInFlight(doc.status) ? 'Reading…' : 'No expiry found'}</span>;
  return (
    <span className="expiry">
      <span className="expiry-days">{describeDaysUntil(daysUntil(expiry))}</span>
      <span className="expiry-date">{formatDate(expiry)}</span>
    </span>
  );
}

export function DocumentList({ documents }: { documents: DocumentRecord[] }) {
  if (documents.length === 0) {
    return (
      <section className="empty" aria-label="Documents">
        <span className="empty-icon">
          <Icon name="file" size={26} />
        </span>
        <p className="empty-title">No documents yet</p>
        <p className="empty-body">Upload a licence, policy, permit or contract and Lapse will find its dates.</p>
      </section>
    );
  }

  return (
    <ul className="doc-list" aria-label="Documents">
      {[...documents].sort(byUrgency).map((doc) => {
        const path = `/documents/${doc.docId}`;
        const x = doc.extraction;
        return (
          <li key={doc.docId}>
            <a className={`doc-row tone-${docUrgency(doc)}`} href={path} onClick={linkHandler(path)}>
              <span className={`doc-icon${isInFlight(doc.status) ? ' doc-icon-busy' : ''}`}>
                <Icon name="file" size={20} />
              </span>
              <span className="doc-main">
                <span className="doc-title">{x?.title ?? doc.filename}</span>
                <span className="doc-meta">{x ? [x.documentType, x.issuer].filter(Boolean).join(' · ') : doc.filename}</span>
              </span>
              <Expiry doc={doc} />
              <StatusBadge status={doc.status} />
              <span className="doc-chevron">
                <Icon name="chevron" size={18} />
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
