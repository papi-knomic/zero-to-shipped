import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeExtraction } from './normalize.ts';
import type { ExtractionResult } from './types.ts';

const base: ExtractionResult = {
  documentType: 'Certificate',
  title: 'Fire Safety Certificate',
  issuer: 'Lagos State Fire and Rescue Service',
  parties: [],
  dates: [{ label: 'issue', isoDate: '2025-10-14', evidence: 'Date of Issue: 14/10/2025', confidence: 0.9 }],
  validityPeriod: 'P12M',
  notes: null,
};

describe('normalizeExtraction', () => {
  it('computes expiry from issue date + validity period', () => {
    const expiry = normalizeExtraction(base).dates.find((d) => d.label === 'expiry');
    assert.deepEqual(expiry, {
      label: 'expiry',
      isoDate: '2026-10-14',
      evidence: 'Computed: issue date + P12M',
      confidence: 0.9,
      computed: true,
    });
  });

  it('falls back to the effective date', () => {
    const input = { ...base, dates: [{ ...base.dates[0]!, label: 'effective' as const }], validityPeriod: 'P2Y' };
    assert.equal(normalizeExtraction(input).dates.find((d) => d.label === 'expiry')?.isoDate, '2027-10-14');
  });

  it('never overrides an explicit expiry date', () => {
    const input: ExtractionResult = {
      ...base,
      dates: [...base.dates, { label: 'expiry', isoDate: '2026-06-30', evidence: 'Expires 30/06/2026', confidence: 0.8 }],
    };
    assert.equal(normalizeExtraction(input), input);
  });

  it('leaves results unchanged without a period, a base date, or with a malformed period', () => {
    assert.equal(normalizeExtraction({ ...base, validityPeriod: null }).dates.length, 1);
    assert.equal(normalizeExtraction({ ...base, dates: [] }).dates.length, 0);
    assert.equal(normalizeExtraction({ ...base, validityPeriod: 'twelve months' }).dates.length, 1);
  });
});
