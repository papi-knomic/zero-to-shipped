import { mockExtractor } from './mock.ts';
import { textractExtractor } from './textract.ts';
import type { Extractor } from './types.ts';

/** Selected by EXTRACTOR env var. bedrock stays off while the account's Bedrock access is blocked. */
export function getExtractor(name = process.env.EXTRACTOR ?? 'mock'): Extractor {
  switch (name) {
    case 'mock':
      return mockExtractor;
    case 'textract':
      return textractExtractor;
    default:
      throw new Error(`Unknown or not yet implemented EXTRACTOR: ${name}`);
  }
}

export { normalizeExtraction } from './normalize.ts';
export type { Extractor, ExtractionResult, ExtractedDate, DateLabel } from './types.ts';
