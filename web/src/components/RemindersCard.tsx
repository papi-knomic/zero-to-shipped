import { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { daysUntil, formatDate, formatDateTime } from '../lib/format';
import { REMINDER_OFFSETS, type DocumentRecord, type NotificationRecord } from '../lib/types';
import { EmailDeliverability } from './EmailDeliverability';
import { Icon } from './Icon';
import { NotificationsFeed } from './NotificationsFeed';

const POLL_MS = 8000;

interface Props {
  doc: DocumentRecord;
  onEdit: () => void;
  onChanged: () => void;
}

/** Shown once a document is ACTIVE: where reminders go, when they fire, and what was sent. */
export function RemindersCard({ doc, onEdit, onChanged }: Props) {
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [busy, setBusy] = useState<'test' | 'stop' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const expiry = doc.confirmed!.expiryDate;
  const testPending = doc.testReminderAt !== undefined;

  // Load this document's reminders; poll while a test reminder is on its way.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const all = await api.listNotifications();
        if (cancelled) return;
        setNotifications(all.filter((n) => n.docId === doc.docId));
        if (testPending) {
          timer = window.setTimeout(() => {
            onChanged(); // refetch the document: testReminderAt clears when the reminder fires
            void load();
          }, POLL_MS);
        }
      } catch {
        /* feed is best-effort */
      }
    };
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [doc.docId, testPending, onChanged]);

  async function sendTest() {
    setBusy('test');
    setMessage(null);
    try {
      const { scheduledFor, email } = await api.sendTestReminder(doc.docId);
      setMessage({ kind: 'ok', text: `Test reminder scheduled for ${formatDateTime(scheduledFor)}, to ${email}. It will appear below.` });
      onChanged();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not schedule a test reminder.' });
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    if (!window.confirm('Stop all reminders for this document?')) return;
    setBusy('stop');
    try {
      await api.confirmDocument(doc.docId, doc.confirmed!, null);
      onChanged();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not stop reminders.' });
    } finally {
      setBusy(null);
    }
  }

  const scheduled = new Map((doc.reminders ?? []).map((r) => [r.offsetDays, r]));
  const remindersOn = Boolean(doc.reminderEmail);

  return (
    <section className="card reminders">
      <div className="reminders-head">
        <div>
          <h2>Reminders</h2>
          <p className="muted small">
            {remindersOn ? (
              <>
                Sending to <b>{doc.reminderEmail}</b> at 09:00 WAT.
              </>
            ) : (
              'Reminders are off for this document.'
            )}
          </p>
        </div>
        <div className="reminders-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
            Edit details
          </button>
          {remindersOn && (
            <button type="button" className="btn btn-primary btn-sm" onClick={sendTest} disabled={busy !== null || testPending}>
              {busy === 'test' || testPending ? <span className="spinner spinner-sm spinner-on-brand" /> : <Icon name="bell" size={15} />}
              {testPending ? 'Test reminder on its way…' : 'Send test reminder'}
            </button>
          )}
        </div>
      </div>

      {remindersOn && doc.reminderEmail && <EmailDeliverability email={doc.reminderEmail} />}

      {message && (
        <p className={`notice ${message.kind === 'ok' ? 'notice-brand' : 'notice-error'}`}>
          <Icon name={message.kind === 'ok' ? 'check' : 'alert'} size={16} />
          {message.text}
        </p>
      )}

      {remindersOn && (
        <ol className="schedule">
          {REMINDER_OFFSETS.map((offset) => {
            const r = scheduled.get(offset);
            const sent = notifications.some((n) => n.offsetDays === offset);
            const fireDate = new Date(Date.parse(expiry) - offset * 86_400_000).toISOString().slice(0, 10);
            const state = sent ? 'sent' : r ? 'scheduled' : daysUntil(fireDate) < 0 ? 'past' : 'skipped';
            return (
              <li key={offset} className={`schedule-item schedule-${state}`}>
                <span className="schedule-offset">{offset} days before</span>
                <span className="schedule-date">{formatDate(fireDate)}</span>
                <span className="schedule-state">
                  {state === 'sent' ? 'Sent' : state === 'scheduled' ? 'Scheduled' : 'Already passed when confirmed'}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <h3 className="feed-heading">Sent for this document</h3>
      <NotificationsFeed notifications={notifications} showDocLinks={false} />

      {remindersOn && (
        <button type="button" className="link-button link-danger" onClick={stop} disabled={busy !== null}>
          Stop reminders
        </button>
      )}
    </section>
  );
}
