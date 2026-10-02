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

// A QUERY block and its answer, as Textract returns them (one pair per page for multi-page PDFs).
const query = (Alias: string, Text: string, Confidence: number, Page = 1): Block[] => [
  { BlockType: 'QUERY', Id: `q-${Alias}-${Page}`, Page, Query: { Alias, Text: Alias }, Relationships: [{ Type: 'ANSWER', Ids: [`r-${Alias}-${Page}`] }] },
  { BlockType: 'QUERY_RESULT', Id: `r-${Alias}-${Page}`, Page, Text, Confidence },
];

// Builds a minimal Textract response: LINE blocks plus one answer per query.
function synthetic(lines: string[], answers: Record<string, [text: string, confidence: number]>): Block[] {
  const blocks: Block[] = lines.map((Text, i) => ({ BlockType: 'LINE', Id: `l${i}`, Text }));
  for (const [alias, [text, confidence]] of Object.entries(answers)) blocks.push(...query(alias, text, confidence));
  return blocks;
}

describe('fromBlocks (multi-page)', () => {
  // Shape of the live response for a 3-page contract: the term is on page 2, signatures on page 3.
  const blocks: Block[] = [
    ...['SERVICE AGREEMENT', 'BETWEEN Adebayo Foods Limited (the Client)', 'AND CleanPro Limited (the Contractor)'].map(
      (Text, i): Block => ({ BlockType: 'LINE', Id: `l${i}`, Page: 1, Text }),
    ),
    { BlockType: 'LINE', Id: 'l-term', Page: 2, Text: 'This Agreement commences on 01/11/2025 and expires on 31/10/2026,' },
    ...query('TYPE', 'SERVICE AGREEMENT', 90, 1),
    ...query('TYPE', 'SIGNATURES', 95, 3),
    ...query('EXPIRY', '01/11/2025', 45, 1), // a weak wrong guess on page 1
    ...query('EXPIRY', '31/10/2026', 98, 2),
  ];

  it('takes the title from the first page and dates from whichever page answers best', () => {
    const r = fromBlocks(blocks, 'agreement.pdf');
    assert.equal(r.title, 'Service Agreement');
    assert.equal(r.documentType, 'Contract');
    assert.deepEqual(r.parties, ['Adebayo Foods Limited (Client)', 'CleanPro Limited (Contractor)']);
    assert.equal(date(r, 'expiry')?.isoDate, '2026-10-31');
  });
});

describe('fromBlocks (synthetic)', () => {
  // Layout from a real invoice: labels on one row, two-digit-year values on the next.
  const lines = ['INVOICE', 'BILL TO:', 'Acme Trading Limited', 'Ada Obi', 'Invoice #:', 'Date:', 'Invoice Due Date:', '01/10/26', '08/10/26'];
  const answers = {
    TYPE: ['INVOICE', 81],
    HOLDER: ['Ada Obi', 40], // Textract's generic answer names the sender
    FROM: ['Ada Obi', 100],
    BILL_TO: ['Acme Trading Limited', 98],
    ISSUE: ['01/10/26', 91],
    DUE: ['08/10/26', 96],
  } satisfies Record<string, [string, number]>;

  it('invoice: the due date becomes the date to be reminded about', () => {
    const r = fromBlocks(synthetic(lines, answers), 'invoice.pdf');
    assert.equal(r.documentType, 'Invoice');
    assert.equal(date(r, 'issue')?.isoDate, '2026-10-01');
    assert.equal(date(r, 'expiry')?.isoDate, '2026-10-08');
  });

  it('invoice: sender is the issuer and the "Bill to" customer is the party, not the letterhead company', () => {
    const r = fromBlocks(synthetic(lines, answers), 'invoice.pdf');
    assert.equal(r.issuer, 'Ada Obi');
    assert.deepEqual(r.parties, ['Acme Trading Limited']);
  });

  it('a due date never displaces a real expiry date', () => {
    const r = fromBlocks(
      synthetic(['Premium due: 01/12/2025', 'Expires 30/11/2026'], {
        EXPIRY: ['30/11/2026', 70],
        DUE: ['01/12/2025', 95],
      }),
      'policy.pdf',
    );
    assert.equal(date(r, 'expiry')?.isoDate, '2026-11-30');
  });
});
