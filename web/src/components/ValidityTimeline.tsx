import { daysUntil, describeDaysUntil, formatDate, urgency } from '../lib/format';
import type { ExtractedDate } from '../lib/types';

const DAY = 86_400_000;
const REMINDER_OFFSETS = [60, 30, 7];

/**
 * Start (issue/effective) → expiry, with today and the reminder points marked.
 * Without a start date, shows the last 90 days before expiry.
 */
export function ValidityTimeline({ dates }: { dates: ExtractedDate[] }) {
  const expiry = dates.find((d) => d.label === 'expiry');
  if (!expiry) return null;

  const startDate = dates.find((d) => d.label === 'issue') ?? dates.find((d) => d.label === 'effective');
  const end = Date.parse(expiry.isoDate);
  const start = startDate ? Date.parse(startDate.isoDate) : end - 90 * DAY;
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - start) / Math.max(end - start, DAY)) * 100));

  const days = daysUntil(expiry.isoDate);
  const tone = `tone-${urgency(days)}`;
  const reminders = REMINDER_OFFSETS.map((n) => ({ n, t: end - n * DAY })).filter((r) => r.t > start);

  return (
    <section className={`card timeline ${tone}`} aria-label="Validity timeline">
      <div className="timeline-head">
        <div>
          <p className="eyebrow">Validity</p>
          <p className="timeline-days">{describeDaysUntil(days)}</p>
        </div>
        <p className="muted small timeline-note">Reminders go out 60, 30 and 7 days before expiry.</p>
      </div>

      <div className="track">
        <div className="track-fill" style={{ width: `${pct(today)}%` }} />
        {reminders.map((r) => (
          <span
            key={r.n}
            className={`tick${today >= r.t ? ' tick-past' : ''}`}
            style={{ left: `${pct(r.t)}%` }}
            title={`Reminder ${r.n} days before expiry`}
          >
            <span className="tick-label">{r.n}d</span>
          </span>
        ))}
        <span className="today" style={{ left: `${pct(today)}%` }} title="Today" />
      </div>

      <div className="track-ends">
        <span>{startDate ? `${startDate.label === 'issue' ? 'Issued' : 'Effective'} ${formatDate(startDate.isoDate)}` : ''}</span>
        <span>Expires {formatDate(expiry.isoDate)}</span>
      </div>
    </section>
  );
}
