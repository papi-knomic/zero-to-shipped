import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { documentCategory, evidenceLine, issuerFromHeader, parseDates, parseValidity, tidyCase } from './parse.ts';

describe('parseDates', () => {
  it('reads day-first numeric dates', () => {
    assert.deepEqual(parseDates('Date of Issue: 05/10/2025'), ['2025-10-05']);
    assert.deepEqual(parseDates('Issued 5-10-2025'), ['2025-10-05']);
    assert.deepEqual(parseDates('on 05.10.25'), ['2025-10-05']);
  });

  it('falls back to month-first only when day-first is impossible', () => {
    assert.deepEqual(parseDates('10/25/2025'), ['2025-10-25']);
    assert.deepEqual(parseDates('31/02/2025'), []);
  });

  it('reads written-out dates', () => {
    assert.deepEqual(parseDates('expires on 31st December, 2026.'), ['2026-12-31']);
    assert.deepEqual(parseDates('made this 1st day of March 2025'), ['2025-03-01']);
    assert.deepEqual(parseDates('5 Oct 2025'), ['2025-10-05']);
    assert.deepEqual(parseDates('October 5, 2025'), ['2025-10-05']);
    assert.deepEqual(parseDates('2025-10-05'), ['2025-10-05']);
  });

  it('returns every date in reading order', () => {
    assert.deepEqual(parseDates('From 25/11/2025 to 24/11/2026 (both days inclusive)'), ['2025-11-25', '2026-11-24']);
  });

  it('ignores reference numbers that are not dates', () => {
    assert.deepEqual(parseDates('Policy Number: LAC/FSP/2025/004417'), []);
    assert.deepEqual(parseDates('TIN: 21458897-0001'), []);
  });
});

describe('parseValidity', () => {
  it('turns stated durations into ISO periods', () => {
    assert.equal(parseValidity('valid for twelve (12) calendar months from the date of issue'), 'P12M');
    assert.equal(parseValidity('a term of two (2) years'), 'P2Y');
    assert.equal(parseValidity('valid for 90 days'), 'P90D');
    assert.equal(parseValidity('valid for one year'), 'P1Y');
    assert.equal(parseValidity('valid for a year'), 'P1Y');
    assert.equal(parseValidity('6 weeks'), 'P6W');
  });

  it('returns null when there is no duration', () => {
    assert.equal(parseValidity('26/10/2026'), null);
    assert.equal(parseValidity('From 25/11/2025 to 24/11/2026'), null);
  });
});

describe('text helpers', () => {
  it('title-cases shouted text but keeps acronyms and mixed case', () => {
    assert.equal(tidyCase('LAGOS STATE FIRE AND RESCUE SERVICE'), 'Lagos State Fire and Rescue Service');
    assert.equal(tidyCase('FIRS TAX CLEARANCE CERTIFICATE'), 'FIRS Tax Clearance Certificate');
    assert.equal(tidyCase('Fire Safety Certificate'), 'Fire Safety Certificate');
  });

  it('categorises documents', () => {
    assert.equal(documentCategory('FIRE AND SPECIAL PERILS INSURANCE POLICY'), 'Insurance policy');
    assert.equal(documentCategory('TAX CLEARANCE CERTIFICATE'), 'Tax clearance certificate');
    assert.equal(documentCategory('BUSINESS PREMISES REGISTRATION PERMIT'), 'Permit');
    assert.equal(documentCategory('TENANCY AGREEMENT'), 'Contract');
    assert.equal(documentCategory('Fire Safety Certificate'), 'Certificate');
  });

  it('picks the most specific organisation from the letterhead', () => {
    assert.equal(
      issuerFromHeader(['LAGOS STATE GOVERNMENT', 'LAGOS STATE FIRE AND RESCUE SERVICE', 'Alausa, Ikeja, Lagos']),
      'Lagos State Fire and Rescue Service',
    );
    assert.equal(issuerFromHeader(['TENANCY AGREEMENT', 'THIS AGREEMENT is made']), null);
    assert.equal(issuerFromHeader(['TENANCY AGREEMENT', 'AND Adebayo Foods Limited (the Tenant)']), null);
  });

  it('finds the line an answer was quoted from', () => {
    const lines = ['Policy Number: X', 'Period of Insurance: From 25/11/2025 to 24/11/2026 (both days inclusive)'];
    assert.equal(evidenceLine(lines, 'From 25/11/2025  to 24/11/2026'), lines[1]);
    assert.equal(evidenceLine(lines, 'nowhere'), 'nowhere');
  });
});
