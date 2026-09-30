import { mockExtractor } from './mock.ts';
import type { Extractor } from './types.ts';

/** Selected by EXTRACTOR env var. bedrock and textract arrive in M3. */
export function getExtractor(name = process.env.EXTRACTOR ?? 'mock'): Extractor {
  switch (name) {
    case 'mock':
      return mockExtractor;
    default:
      throw new Error(`Unknown or not yet implemented EXTRACTOR: ${name}`);
  }
}

export { normalizeExtraction } from './normalize.ts';
export type { Extractor, ExtractionResult, ExtractedDate, DateLabel } from './types.ts';
