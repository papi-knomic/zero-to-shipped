import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Block } from '@aws-sdk/client-textract';
import { checkDigit, readMrz } from './mrz.ts';
import { parseDates } from './parse.ts';
import { fromBlocks } from './textract.ts';

// ICAO 9303 specimen passport (fictional "Utopia"), as printed in the standard.
const SPECIMEN = ['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898902C36UTO7408122F1204159ZE184226B<<<<<10'];

/** A fictional Nigerian passport MRZ with correct check digits. */
function nigerianMrz(expiryYymmdd: string): string[] {
  const docNo = 'A12345678';
  const dob = '900101';
  const line2 = `${docNo}${checkDigit(docNo)}NGA${dob}${checkDigit(dob)}M${expiryYymmdd}${checkDigit(expiryYymmdd)}<<<<<<<<<<<<<<0`;
  return ['P<NGAOKAFOR<<CHIDI<EMEKA'.padEnd(44, '<'), line2.padEnd(44, '<').slice(0, 44)];
}

const lineBlocks = (lines: string[]): Block[] => lines.map((Text, i) => ({ BlockType: 'LINE', Id: `l${i}`, Text }));

describe('MRZ', () => {
  it('reads the ICAO specimen: holder, state and expiry from check-digit-verified fields', () => {
    assert.equal(checkDigit('120415'), 9);
    assert.deepEqual(readMrz(SPECIMEN), { kind: 'passport', issuingState: 'UTO', holder: 'Anna Maria Eriksson', expiryDate: '2012-04-15' });
  });

  it('tolerates OCR spacing and « for <', () => {
    const spaced = SPECIMEN.map((l) => l.replace(/<</g, '« ').replace(/(.{10})/g, '$1 '));
    assert.equal(readMrz(spaced)?.expiryDate, '2012-04-15');
  });

  it('rejects an expiry whose check digit fails (a misread digit)', () => {
    const misread = [SPECIMEN[0]!, SPECIMEN[1]!.replace('1204159', '1204169')];
    assert.equal(readMrz(misread), null);
  });

  it('ignores ordinary text', () => {
    assert.equal(readMrz(['FIRE SAFETY CERTIFICATE', 'Date of Issue: 06/10/2025']), null);
  });
});

describe('passport extraction', () => {
  const page = [
    'FEDERAL REPUBLIC OF NIGERIA',
    'PASSPORT',
    'Date of issue / Date de délivrance',
    '14 MAR /MARS 21',
    'Date of expiry / Date d’expiration',
    '13 MAR /MARS 31',
    ...nigerianMrz('310313'),
  ];

  it('builds a passport record from the MRZ, quoting the printed expiry line, never the MRZ', () => {
    const blocks: Block[] = [
      ...lineBlocks(page),
      { BlockType: 'QUERY', Id: 'q1', Page: 1, Query: { Alias: 'ISSUE', Text: 'ISSUE' }, Relationships: [{ Type: 'ANSWER', Ids: ['r1'] }] },
      { BlockType: 'QUERY_RESULT', Id: 'r1', Page: 1, Text: '14 MAR /MARS 21', Confidence: 88 },
      { BlockType: 'QUERY', Id: 'q2', Page: 1, Query: { Alias: 'EXPIRY', Text: 'EXPIRY' }, Relationships: [{ Type: 'ANSWER', Ids: ['r2'] }] },
      { BlockType: 'QUERY_RESULT', Id: 'r2', Page: 1, Text: '13 MAR /MARS 31', Confidence: 90 },
    ];
    const r = fromBlocks(blocks, 'passport.jpg');
    assert.equal(r.documentType, 'Passport');
    assert.equal(r.issuer, 'Federal Republic of Nigeria');
    assert.deepEqual(r.parties, ['Chidi Emeka Okafor']);
    assert.deepEqual(r.dates.map((d) => [d.label, d.isoDate]), [['issue', '2021-03-14'], ['expiry', '2031-03-13']]);
    assert.equal(r.dates[1]!.evidence, '13 MAR /MARS 31');
    assert.ok(!JSON.stringify(r).includes('A12345678') && !JSON.stringify(r).includes('900101'), 'no document number or date of birth');
  });

  it('without a printed match, the evidence names the MRZ rather than quoting it', () => {
    const r = fromBlocks(lineBlocks(nigerianMrz('310313')), 'passport.jpg');
    assert.equal(r.dates[0]!.isoDate, '2031-03-13');
    assert.match(r.dates[0]!.evidence, /^Machine-readable zone/);
  });
});

describe('passport-style printed dates', () => {
  it('parses bilingual month names with two- or four-digit years', () => {
    assert.deepEqual(parseDates('13 MAR /MARS 31'), ['2031-03-13']);
    assert.deepEqual(parseDates('02 FEB /FÉV 2030'), ['2030-02-02']);
    assert.deepEqual(parseDates('5 Oct 2025'), ['2025-10-05']);
    assert.deepEqual(parseDates('valid for 12 months 2031'), []);
  });
});
