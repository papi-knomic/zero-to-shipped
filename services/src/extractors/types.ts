export type DateLabel = 'issue' | 'effective' | 'expiry' | 'renewal';

export interface ExtractedDate {
  label: DateLabel;
  /** YYYY-MM-DD */
  isoDate: string;
  /** Verbatim quote from the document that the date was read from. */
  evidence: string;
  /** 0..1 */
  confidence: number;
  /** True when derived in code (e.g. issue date + validity period), not read from the document. */
  computed?: boolean;
}

export interface ExtractionResult {
  documentType: string;
  title: string;
  issuer: string | null;
  parties: string[];
  dates: ExtractedDate[];
  /** ISO 8601 duration when the document states a validity period instead of an expiry date. */
  validityPeriod: string | null;
  notes: string | null;
}

export interface Extractor {
  readonly name: string;
  extract(bucket: string, key: string): Promise<ExtractionResult>;
}
