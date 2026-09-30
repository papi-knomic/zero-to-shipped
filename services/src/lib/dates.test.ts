import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addIsoDuration, isIsoDate, toDayFirst } from './dates.ts';

describe('addIsoDuration', () => {
  it('adds months and years', () => {
    assert.equal(addIsoDuration('2025-10-14', 'P12M'), '2026-10-14');
    assert.equal(addIsoDuration('2025-10-14', 'P1Y'), '2026-10-14');
    assert.equal(addIsoDuration('2025-11-30', 'P3M'), '2026-02-28');
    assert.equal(addIsoDuration('2025-10-14', 'P1Y2M10D'), '2026-12-24');
  });

  it('clamps to the end of shorter months', () => {
    assert.equal(addIsoDuration('2025-01-31', 'P1M'), '2025-02-28');
    assert.equal(addIsoDuration('2024-01-31', 'P1M'), '2024-02-29');
    assert.equal(addIsoDuration('2024-02-29', 'P1Y'), '2025-02-28');
  });

  it('adds weeks and days across month and year boundaries', () => {
    assert.equal(addIsoDuration('2025-12-25', 'P2W'), '2026-01-08');
    assert.equal(addIsoDuration('2025-02-27', 'P2D'), '2025-03-01');
  });

  it('rejects bad input', () => {
    assert.throws(() => addIsoDuration('14/10/2025', 'P1Y'));
    assert.throws(() => addIsoDuration('2025-10-14', 'P'));
    assert.throws(() => addIsoDuration('2025-10-14', 'PT12H'));
    assert.throws(() => addIsoDuration('2025-10-14', '12 months'));
  });
});

describe('isIsoDate', () => {
  it('accepts only real calendar dates', () => {
    assert.equal(isIsoDate('2024-02-29'), true);
    assert.equal(isIsoDate('2025-02-29'), false);
    assert.equal(isIsoDate('2025-13-01'), false);
    assert.equal(isIsoDate('2025-1-01'), false);
  });
});

describe('toDayFirst', () => {
  it('formats as DD/MM/YYYY', () => {
    assert.equal(toDayFirst('2025-03-04'), '04/03/2025');
  });
});
