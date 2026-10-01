import { isIsoDate } from './dates.ts';

/** Days before expiry that reminders go out. */
export const REMINDER_OFFSETS = [60, 30, 7] as const;

/** Reminders fire at 09:00 West Africa Time (UTC+1, no DST), i.e. 08:00 UTC. */
const SEND_HOUR_UTC = 8;
/** Scheduler needs a little lead time; anything sooner than this is treated as past. */
const MIN_LEAD_MS = 60_000;

export interface ReminderTime {
  offsetDays: number;
  at: Date;
}

/** The reminder times for an expiry date that are still in the future, soonest last. */
export function reminderTimes(expiryDate: string, now: Date = new Date()): ReminderTime[] {
  if (!isIsoDate(expiryDate)) throw new Error(`Invalid expiry date: ${expiryDate}`);
  const [y, m, d] = expiryDate.split('-').map(Number) as [number, number, number];

  return REMINDER_OFFSETS.map((offsetDays) => ({
    offsetDays,
    at: new Date(Date.UTC(y, m - 1, d - offsetDays, SEND_HOUR_UTC)),
  })).filter((r) => r.at.getTime() - now.getTime() >= MIN_LEAD_MS);
}

/** Schedule names must be unique per group and ≤ 64 chars: <docId>-<offset>d or <docId>-test. */
export function scheduleName(docId: string, offsetDays: number | 'test'): string {
  return offsetDays === 'test' ? `${docId}-test` : `${docId}-${offsetDays}d`;
}

/** EventBridge Scheduler one-time expression, evaluated in UTC. */
export function atExpression(at: Date): string {
  return `at(${at.toISOString().slice(0, 19)})`;
}

/** Whole days from `now` (UTC date) until the expiry date; negative once expired. */
export function daysUntil(expiryDate: string, now: Date = new Date()): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const [y, m, d] = expiryDate.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - today) / 86_400_000);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL.test(value);
}
