import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { atExpression, daysUntil, isEmail, reminderTimes, scheduleName } from './reminders.ts';

describe('reminderTimes', () => {
  const now = new Date('2026-10-01T12:00:00Z');

  it('returns 60/30/7-day reminders at 08:00 UTC (09:00 WAT)', () => {
    const times = reminderTimes('2027-01-15', now);
    assert.deepEqual(
      times.map((t) => [t.offsetDays, t.at.toISOString()]),
      [
        [60, '2026-11-16T08:00:00.000Z'],
        [30, '2026-12-16T08:00:00.000Z'],
        [7, '2027-01-08T08:00:00.000Z'],
      ],
    );
  });

  it('drops reminders that are already in the past', () => {
    // Expires in 20 days: only the 7-day reminder is still ahead.
    assert.deepEqual(reminderTimes('2026-10-21', now).map((t) => t.offsetDays), [7]);
    assert.deepEqual(reminderTimes('2026-10-05', now), []);
    assert.deepEqual(reminderTimes('2025-01-01', now), []);
  });

  it('treats a reminder less than a minute away as past', () => {
    const justBefore = new Date('2026-11-16T07:59:30Z');
    assert.equal(reminderTimes('2027-01-15', justBefore)[0]!.offsetDays, 30);
  });

  it('rejects invalid dates', () => {
    assert.throws(() => reminderTimes('15/01/2027', now));
  });
});

describe('helpers', () => {
  it('builds schedule names and at() expressions', () => {
    const id = '0dd7dded-7fef-4408-94ff-682eb7e73ccb';
    assert.equal(scheduleName(id, 30), `${id}-30d`);
    assert.equal(scheduleName(id, 'test'), `${id}-test`);
    assert.ok(scheduleName(id, 60).length <= 64);
    assert.equal(atExpression(new Date('2026-11-16T08:00:00.000Z')), 'at(2026-11-16T08:00:00)');
  });

  it('counts days until expiry by calendar date', () => {
    const now = new Date('2026-10-01T23:30:00Z');
    assert.equal(daysUntil('2026-10-01', now), 0);
    assert.equal(daysUntil('2026-10-31', now), 30);
    assert.equal(daysUntil('2026-09-30', now), -1);
  });

  it('validates email addresses', () => {
    assert.equal(isEmail('ada@reck-tech.com'), true);
    assert.equal(isEmail('not-an-email'), false);
    assert.equal(isEmail('a b@c.com'), false);
    assert.equal(isEmail(42), false);
  });
});
