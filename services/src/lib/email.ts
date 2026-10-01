import { toDayFirst } from './dates.ts';

export interface ReminderEmailInput {
  title: string;
  documentType: string;
  issuer: string | null;
  expiryDate: string;
  daysLeft: number;
  documentUrl: string;
  test: boolean;
}

function when(daysLeft: number): string {
  if (daysLeft < 0) return `expired ${-daysLeft} day${daysLeft === -1 ? '' : 's'} ago`;
  if (daysLeft === 0) return 'expires today';
  return `expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain, transactional reminder: one document, one date, one link. */
export function renderReminderEmail(r: ReminderEmailInput): { subject: string; text: string; html: string } {
  const date = toDayFirst(r.expiryDate);
  const issuedBy = r.issuer ? ` (issued by ${r.issuer})` : '';
  const status = when(r.daysLeft);
  const subject = `${r.test ? '[Test] ' : ''}${r.title} ${status}`;
  const action =
    r.daysLeft < 0 ? 'Renew it as soon as possible.' : 'Start the renewal now to avoid penalties or interruptions.';
  const testNote = r.test ? 'This is a test reminder you requested from the Lapse demo.\n\n' : '';

  const text = [
    'Hi,',
    '',
    `${testNote}This is a reminder from Lapse. Your ${r.title}${issuedBy} ${status === 'expires today' ? 'expires today' : `expires on ${date}`}${r.daysLeft > 0 ? `, which is in ${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'}` : ''}. ${action}`,
    '',
    `View the document: ${r.documentUrl}`,
    '',
    'You’re receiving this because you asked Lapse to remind you about this document. To stop reminders, open the link above and choose "Stop reminders".',
    '',
    '— Lapse',
  ].join('\n');

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f5f6fb;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e3e7f0;border-radius:14px">
    <tr><td style="padding:28px">
      <p style="margin:0 0 16px;font-weight:800;font-size:18px;color:#4f46e5">Lapse</p>
      ${r.test ? '<p style="margin:0 0 16px;padding:8px 12px;background:#eef0ff;border-radius:8px;font-size:13px;color:#4338ca">This is a test reminder you requested from the Lapse demo.</p>' : ''}
      <p style="margin:0 0 6px;font-size:13px;color:#5b6479;text-transform:uppercase;letter-spacing:.06em">${escape(r.documentType)}</p>
      <p style="margin:0 0 4px;font-size:20px;font-weight:700">${escape(r.title)}</p>
      ${r.issuer ? `<p style="margin:0 0 18px;font-size:14px;color:#5b6479">${escape(r.issuer)}</p>` : ''}
      <p style="margin:0 0 6px;font-size:28px;font-weight:800;color:${r.daysLeft <= 7 ? '#dc2626' : r.daysLeft <= 30 ? '#b45309' : '#0f172a'}">${escape(status.charAt(0).toUpperCase() + status.slice(1))}</p>
      <p style="margin:0 0 20px;font-size:15px">Expiry date: <b>${date}</b>. ${escape(action)}</p>
      <a href="${escape(r.documentUrl)}" style="display:inline-block;padding:11px 18px;background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px">View document</a>
      <p style="margin:24px 0 0;font-size:12px;color:#8b93a7">You’re receiving this because you asked Lapse to remind you about this document. To stop reminders, open the document and choose “Stop reminders”.</p>
    </td></tr>
  </table>
</body></html>`;

  return { subject, text, html };
}
