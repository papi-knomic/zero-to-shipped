import {
  AnalyzeDocumentCommand,
  GetDocumentAnalysisCommand,
  StartDocumentAnalysisCommand,
  TextractClient,
  UnsupportedDocumentException,
  type Block,
  type Query,
} from '@aws-sdk/client-textract';
import { tracer } from '../lib/observability.ts';
import { contractParties, documentCategory, evidenceLine, issuerFromHeader, parseDates, parseValidity, tidyCase } from './parse.ts';
import type { ExtractedDate, ExtractionResult, Extractor } from './types.ts';

// Textract AnalyzeDocument with Queries: ask the document questions, get answers with confidence.
// All interpretation (dates, durations, which answer to trust) happens in fromBlocks().

const QUERIES = {
  TYPE: 'What type of document is this?',
  TITLE: 'What is the title of this document?',
  ISSUER: 'Who issued this document?',
  HOLDER: 'Who is this document issued to?',
  ISSUE: 'What is the date of issue?',
  EFFECTIVE: 'What is the start or effective date?',
  EXPIRY: 'What is the expiry date?',
  VALID_UNTIL: 'Valid until what date?',
  PERIOD: 'What is the period of insurance or term?',
  VALIDITY: 'How long is this document valid for?',
} as const;
type Alias = keyof typeof QUERIES;

/** Answers below this are ignored entirely. */
const MIN_CONFIDENCE = 0.4;
/** Only the first pages are queried: the dates are on the front, and Textract bills per page. */
const MAX_PAGES = 3;

interface Answer {
  text: string;
  confidence: number;
}

function answers(blocks: Block[]): Partial<Record<Alias, Answer>> {
  const byId = new Map(blocks.map((b) => [b.Id!, b]));
  const out: Partial<Record<Alias, Answer>> = {};
  for (const q of blocks.filter((b) => b.BlockType === 'QUERY')) {
    const alias = q.Query?.Alias as Alias | undefined;
    if (!alias) continue;
    const best = (q.Relationships ?? [])
      .flatMap((r) => r.Ids ?? [])
      .map((id) => byId.get(id))
      .filter((b): b is Block => b?.BlockType === 'QUERY_RESULT' && Boolean(b.Text))
      .sort((a, b) => (b.Confidence ?? 0) - (a.Confidence ?? 0))[0];
    if (best && (best.Confidence ?? 0) / 100 >= MIN_CONFIDENCE) {
      out[alias] = { text: best.Text!, confidence: (best.Confidence ?? 0) / 100 };
    }
  }
  return out;
}

const same = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Maps raw Textract blocks to our extraction schema. Pure, so it's tested on real responses. */
export function fromBlocks(blocks: Block[], filename: string): ExtractionResult {
  const a = answers(blocks);
  const lines = blocks.filter((b) => b.BlockType === 'LINE' && b.Text).map((b) => b.Text!);
  const quote = (ans: Answer) => evidenceLine(lines, ans.text);

  // Title: the short "type" answer usually is the title; the "title" answer sometimes drags in the letterhead.
  const titleSource = [a.TYPE, a.TITLE].find((x) => x && x.text.length <= 70) ?? a.TITLE ?? a.TYPE;
  const title = titleSource ? tidyCase(titleSource.text) : filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  const documentType = documentCategory(`${a.TYPE?.text ?? ''} ${a.TITLE?.text ?? ''} ${title}`);

  // Contracts have parties, not an issuer.
  const isContract = documentType === 'Contract';
  const namedParties = isContract ? contractParties(lines) : [];

  // Issuer: Textract often names the holder as the issuer. Then trust the letterhead instead.
  const issuerAnswer = a.ISSUER && !same(a.ISSUER.text, a.HOLDER?.text) && a.ISSUER.confidence >= 0.5 ? a.ISSUER.text : null;
  const issuer = isContract ? null : issuerAnswer ? tidyCase(issuerAnswer) : issuerFromHeader(lines);
  const parties = namedParties.length ? namedParties : a.HOLDER ? [tidyCase(a.HOLDER.text)] : [];

  const dates: ExtractedDate[] = [];
  const firstDate = (ans?: Answer) => (ans ? parseDates(ans.text)[0] : undefined);

  const issue = firstDate(a.ISSUE);
  if (issue) dates.push({ label: 'issue', isoDate: issue, evidence: quote(a.ISSUE!), confidence: a.ISSUE!.confidence });

  // "From X to Y" answers give both ends of the period.
  const period = a.PERIOD ?? (a.VALIDITY && parseDates(a.VALIDITY.text).length >= 2 ? a.VALIDITY : undefined);
  const periodDates = period ? parseDates(period.text) : [];
  const effectiveAnswer = a.EFFECTIVE ?? (periodDates.length >= 2 ? period : undefined);
  const effective = a.EFFECTIVE ? firstDate(a.EFFECTIVE) : periodDates.length >= 2 ? periodDates[0] : undefined;
  if (effective && effectiveAnswer && effective !== issue) {
    dates.push({ label: 'effective', isoDate: effective, evidence: quote(effectiveAnswer), confidence: effectiveAnswer.confidence });
  }

  // Expiry: the most confident candidate that falls after the start. Textract sometimes answers
  // "valid until?" with the start date.
  const start = [issue, effective].filter(Boolean).sort().at(-1);
  const candidates = [
    a.EXPIRY && { ans: a.EXPIRY, iso: firstDate(a.EXPIRY) },
    a.VALID_UNTIL && { ans: a.VALID_UNTIL, iso: firstDate(a.VALID_UNTIL) },
    period && periodDates.length >= 2 && { ans: period, iso: periodDates.at(-1) },
    a.VALIDITY && parseDates(a.VALIDITY.text).length === 1 && { ans: a.VALIDITY, iso: firstDate(a.VALIDITY) },
  ]
    .filter((c): c is { ans: Answer; iso: string } => Boolean(c && c.iso))
    .filter((c) => !start || c.iso > start)
    .sort((x, y) => y.ans.confidence - x.ans.confidence);
  const expiry = candidates[0];
  if (expiry) dates.push({ label: 'expiry', isoDate: expiry.iso, evidence: quote(expiry.ans), confidence: expiry.ans.confidence });

  const validitySource = [a.VALIDITY, a.VALID_UNTIL, a.PERIOD].find((x) => x && parseValidity(x.text));
  const validityPeriod = validitySource ? parseValidity(validitySource.text) : null;

  const reference = lines.find((l) => /\b(no|number)\s*[:.]/i.test(l));

  return {
    documentType,
    title,
    issuer,
    parties,
    dates,
    validityPeriod,
    notes: reference ?? null,
  };
}

const client = tracer.captureAWSv3Client(new TextractClient({}));
const queriesConfig = (pages?: string[]) => ({
  Queries: Object.entries(QUERIES).map(([Alias, Text]): Query => ({ Alias, Text, ...(pages ? { Pages: pages } : {}) })),
});

/** Multi-page PDFs need the async API. Polls until done (the Lambda timeout bounds this). */
async function analyzeAsync(bucket: string, key: string): Promise<Block[]> {
  const { JobId } = await client.send(
    new StartDocumentAnalysisCommand({
      DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
      FeatureTypes: ['QUERIES'],
      QueriesConfig: queriesConfig([`1-${MAX_PAGES}`]),
    }),
  );
  for (let delay = 1000; ; delay = Math.min(delay * 1.5, 5000)) {
    await new Promise((r) => setTimeout(r, delay));
    const first = await client.send(new GetDocumentAnalysisCommand({ JobId }));
    if (first.JobStatus === 'IN_PROGRESS') continue;
    if (first.JobStatus !== 'SUCCEEDED' && first.JobStatus !== 'PARTIAL_SUCCESS') {
      throw new Error(`Textract job ${first.JobStatus}: ${first.StatusMessage ?? 'no message'}`);
    }
    const blocks = [...(first.Blocks ?? [])];
    for (let token = first.NextToken; token; ) {
      const page = await client.send(new GetDocumentAnalysisCommand({ JobId, NextToken: token }));
      blocks.push(...(page.Blocks ?? []));
      token = page.NextToken;
    }
    return blocks;
  }
}

export const textractExtractor: Extractor = {
  name: 'textract',
  async extract(bucket: string, key: string): Promise<ExtractionResult> {
    let blocks: Block[];
    try {
      const res = await client.send(
        new AnalyzeDocumentCommand({
          Document: { S3Object: { Bucket: bucket, Name: key } },
          FeatureTypes: ['QUERIES'],
          QueriesConfig: queriesConfig(),
        }),
      );
      blocks = res.Blocks ?? [];
    } catch (err) {
      // The sync API only takes single-page PDFs.
      if (!(err instanceof UnsupportedDocumentException) || !key.toLowerCase().endsWith('.pdf')) throw err;
      blocks = await analyzeAsync(bucket, key);
    }
    return fromBlocks(blocks, key.split('/').pop() ?? key);
  },
};
