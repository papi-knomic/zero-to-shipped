import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderReminderEmail } from './email.ts';

const base = {
  title: 'Fire Safety Certificate',
  documentType: 'Certificate',
  issuer: 'Lagos State Fire and Rescue Service',
  expiryDate: '2026-10-08',
  daysLeft: 7,
  documentUrl: 'https://lapse.reck-tech.com/documents/abc',
  test: false,
};

describe('renderReminderEmail', () => {
  it('states the document, issuer, DD/MM expiry and link', () => {
    const e = renderReminderEmail(base);
    assert.equal(e.subject, 'Fire Safety Certificate expires in 7 days');
    assert.match(e.text, /Fire Safety Certificate \(issued by Lagos State Fire and Rescue Service\) expires on 08\/10\/2026, which is in 7 days\./);
    assert.match(e.text, /https:\/\/lapse\.reck-tech\.com\/documents\/abc/);
    assert.match(e.text, /Stop reminders/);
    assert.match(e.html, /href="https:\/\/lapse\.reck-tech\.com\/documents\/abc"/);
  });

  it('marks test reminders and handles today / expired', () => {
    assert.equal(renderReminderEmail({ ...base, test: true }).subject, '[Test] Fire Safety Certificate expires in 7 days');
    assert.equal(renderReminderEmail({ ...base, daysLeft: 0 }).subject, 'Fire Safety Certificate expires today');
    assert.equal(renderReminderEmail({ ...base, daysLeft: -3 }).subject, 'Fire Safety Certificate expired 3 days ago');
  });

  it('escapes user-entered text in HTML', () => {
    const e = renderReminderEmail({ ...base, title: '<script>x</script>' });
    assert.doesNotMatch(e.html, /<script>/);
    assert.match(e.html, /&lt;script&gt;/);
  });
});
