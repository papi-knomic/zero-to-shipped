import { formatDate, formatDateTime } from '../lib/format';
import { linkHandler } from '../lib/router';
import type { NotificationRecord } from '../lib/types';
import { Icon } from './Icon';

const EMAIL_LABEL: Record<NotificationRecord['emailStatus'], string> = {
  SENT: 'Emailed',
  NOT_DELIVERED: 'In-app only',
  FAILED: 'Email failed',
};

function describe(n: NotificationRecord): string {
  if (n.test) return 'Test reminder';
  return `${n.offsetDays}-day reminder`;
}

/** The in-app reminder feed: every reminder lands here, whether or not the email got through. */
export function NotificationsFeed({ notifications, showDocLinks = true }: { notifications: NotificationRecord[]; showDocLinks?: boolean }) {
  if (notifications.length === 0) {
    return <p className="muted small feed-empty">No reminders sent yet. Confirm a document and use “Send test reminder” to see one arrive.</p>;
  }

  return (
    <ul className="feed">
      {notifications.map((n) => {
        const path = `/documents/${n.docId}`;
        return (
          <li key={`${n.sentAt}-${n.docId}`} className="feed-item">
            <span className={`feed-icon${n.emailStatus === 'SENT' ? ' feed-icon-sent' : ''}`}>
              <Icon name="bell" size={16} />
            </span>
            <div className="feed-main">
              <p className="feed-title">
                {showDocLinks ? (
                  <a href={path} onClick={linkHandler(path)}>
                    {n.title}
                  </a>
                ) : (
                  n.title
                )}{' '}
                <span className="muted">· {describe(n)}</span>
              </p>
              <p className="muted small">
                Expires {formatDate(n.expiryDate)} · sent {formatDateTime(n.sentAt)} to {n.email}
              </p>
            </div>
            <span
              className={`pill email-${n.emailStatus.toLowerCase().replace('_', '-')}`}
              title={n.emailStatus === 'SENT' ? undefined : n.emailDetail}
            >
              {EMAIL_LABEL[n.emailStatus]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
