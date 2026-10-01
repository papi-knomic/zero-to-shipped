import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { Block } from '@aws-sdk/client-textract';
import { normalizeExtraction } from './normalize.ts';
import { fromBlocks } from './textract.ts';

// Real Textract AnalyzeDocument (QUERIES) responses for the generated sample PDFs, trimmed to
// LINE / QUERY / QUERY_RESULT blocks.
const load = (name: string) =>
  normalizeExtraction(
    fromBlocks(JSON.parse(readFileSync(new URL(`./fixtures/${name}.textract.json`, import.meta.url), 'utf8')) as Block[], `${name}.pdf`),
  );
const date = (r: ReturnType<typeof load>, label: string) => r.dates.find((d) => d.label === label);

describe('fromBlocks (real Textract responses)', () => {
  it('fire certificate: issuer from the letterhead, expiry computed from "twelve (12) calendar months"', () => {
    const r = load('fire-safety-certificate');
    assert.equal(r.title, 'Fire Safety Certificate');
    assert.equal(r.documentType, 'Certificate');
    assert.equal(r.issuer, 'Lagos State Fire and Rescue Service'); // Textract's own answer was the holder
    assert.deepEqual(r.parties, ['Adebayo Foods Limited']);
    assert.equal(r.validityPeriod, 'P12M');
    assert.equal(date(r, 'issue')?.isoDate, '2025-10-06');
    assert.equal(date(r, 'issue')?.evidence, 'Date of Issue: 06/10/2025');
    assert.deepEqual([date(r, 'expiry')?.isoDate, date(r, 'expiry')?.computed], ['2026-10-06', true]);
    assert.match(r.notes ?? '', /Certificate No/);
  });

  it('insurance policy: effective and expiry from "From X to Y"', () => {
    const r = load('fire-insurance-policy');
    assert.equal(r.documentType, 'Insurance policy');
    assert.equal(r.issuer, 'Leadway Assurance Company Limited');
    assert.equal(date(r, 'effective')?.isoDate, '2025-11-25');
    assert.equal(date(r, 'expiry')?.isoDate, '2026-11-24');
    assert.match(date(r, 'expiry')?.evidence ?? '', /^Period of Insurance: From 25\/11\/2025 to 24\/11\/2026/);
  });

  it('permit: explicit "Valid until" date', () => {
    const r = load('business-premises-permit');
    assert.equal(r.documentType, 'Permit');
    assert.equal(r.title, 'Business Premises Registration Permit');
    assert.equal(r.issuer, 'Lagos State Ministry of Commerce, Cooperatives, Trade and Investment');
    assert.equal(date(r, 'expiry')?.isoDate, '2026-10-26');
    assert.equal(date(r, 'expiry')?.evidence, 'Valid until: 26/10/2026');
  });

  it('tax clearance: written-out dates', () => {
    const r = load('tax-clearance-certificate');
    assert.equal(r.issuer, 'Federal Inland Revenue Service');
    assert.equal(date(r, 'issue')?.isoDate, '2026-03-15');
    assert.equal(date(r, 'expiry')?.isoDate, '2026-12-31');
  });

  it('tenancy: parties not issuer; a "valid until" answer equal to the start date is rejected', () => {
    const r = load('shop-tenancy-agreement');
    assert.equal(r.documentType, 'Contract');
    assert.equal(r.issuer, null);
    assert.deepEqual(r.parties, ['Chief Olumide Bakare (Landlord)', 'Adebayo Foods Limited (Tenant)']);
    assert.equal(r.validityPeriod, 'P2Y');
    assert.deepEqual([date(r, 'expiry')?.isoDate, date(r, 'expiry')?.computed], ['2026-10-31', true]);
  });
});
