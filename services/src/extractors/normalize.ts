import { addIsoDuration } from '../lib/dates.ts';
import type { ExtractedDate, ExtractionResult } from './types.ts';

/**
 * Post-processing shared by every extractor. When the document gives a validity period
 * but no explicit expiry, expiry = issue (or effective) date + period, computed here
 * rather than trusted to a model.
 */
export function normalizeExtraction(result: ExtractionResult): ExtractionResult {
  const hasExpiry = result.dates.some((d) => d.label === 'expiry');
  if (hasExpiry || !result.validityPeriod) return result;

  const base =
    result.dates.find((d) => d.label === 'issue') ?? result.dates.find((d) => d.label === 'effective');
  if (!base) return result;

  let isoDate: string;
  try {
    isoDate = addIsoDuration(base.isoDate, result.validityPeriod);
  } catch {
    return result; // malformed period or date: leave it for the user to fill in on review
  }

  const expiry: ExtractedDate = {
    label: 'expiry',
    isoDate,
    evidence: `Computed: ${base.label} date + ${result.validityPeriod}`,
    confidence: base.confidence,
    computed: true,
  };
  return { ...result, dates: [...result.dates, expiry] };
}
