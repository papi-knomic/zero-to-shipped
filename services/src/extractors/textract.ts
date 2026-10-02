import {
  AnalyzeDocumentCommand,
  GetDocumentAnalysisCommand,
  StartDocumentAnalysisCommand,
  TextractClient,
  UnsupportedDocumentException,
  type Block,
  type Query,
} from '@aws-sdk/client-textract';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '../lib/aws.ts';
import { logger, tracer } from '../lib/observability.ts';
import { pdfPageCount } from './pdf.ts';
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
  DUE: 'What is the due date or payment deadline?',
  // Invoices: the generic issuer/holder questions don't know which side of "Bill to" is which.
  FROM: 'Who is this invoice from?',
  BILL_TO: 'Who is this invoice billed to?',
} as const;
type Alias = keyof typeof QUERIES;

/** Answers below this are ignored entirely. */
const MIN_CONFIDENCE = 0.4;
/** Only the first pages are queried: Textract bills per page (~$0.015), so this caps the cost of
 * any one upload while still reaching a contract's term clause or a policy schedule. */
const MAX_PAGES = 10;

/** Who/what questions are answered by the letterhead, so the earliest page wins. Dates can sit on
 * any page (a contract's term is often on page 2), so for those the most confident answer wins. */
const FRONT_PAGE = new Set<Alias>(['TYPE', 'TITLE', 'ISSUER', 'HOLDER', 'FROM', 'BILL_TO']);

interface Answer {
  text: string;
  confidence: number;
  page: number;
}

/** Multi-page documents get one QUERY block per page, so answers are merged across pages. */
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
    if (!best || (best.Confidence ?? 0) / 100 < MIN_CONFIDENCE) continue;
    const answer = { text: best.Text!, confidence: (best.Confidence ?? 0) / 100, page: q.Page ?? 1 };
    const current = out[alias];
    const better =
      !current ||
      (FRONT_PAGE.has(alias) && answer.page !== current.page
        ? answer.page < current.page
        : answer.confidence > current.confidence);
    if (better) out[alias] = answer;
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
  const isInvoice = documentType === 'Invoice';
  const issuer = isContract
    ? null
    : isInvoice && a.FROM
      ? tidyCase(a.FROM.text)
      : issuerAnswer
        ? tidyCase(issuerAnswer)
        : issuerFromHeader(lines);
  const holder = isInvoice ? (a.BILL_TO ?? a.HOLDER) : a.HOLDER;
  const parties = namedParties.length ? namedParties : holder ? [tidyCase(holder.text)] : [];

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
  // Invoices and bills have a due date rather than an expiry. Used only when nothing else answered,
  // so a "premium due" line on a policy can't displace the cover's end date.
  const dueIso = firstDate(a.DUE);
  const due = dueIso && (!start || dueIso > start) ? { ans: a.DUE!, iso: dueIso } : undefined;
  const expiry = candidates[0] ?? due;
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

class PageRangeError extends Error {}

/** Multi-page PDFs need the async API. Textract fails the job if the page range runs past the end
 * of the document; if our page count was wrong that way, the document is shorter, so read all of it. */
async function analyzeAsync(bucket: string, key: string, lastPage: number): Promise<Block[]> {
  try {
    return await runAnalysisJob(bucket, key, `1-${lastPage}`);
  } catch (err) {
    if (!(err instanceof PageRangeError)) throw err;
    return runAnalysisJob(bucket, key, '*');
  }
}

async function countPages(bucket: string, key: string): Promise<number | null> {
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return pdfPageCount(await object.Body!.transformToByteArray());
}

/** Starts an async analysis job and polls until done (the Lambda timeout bounds this). */
async function runAnalysisJob(bucket: string, key: string, pages: string): Promise<Block[]> {
  const { JobId } = await client.send(
    new StartDocumentAnalysisCommand({
      DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
      FeatureTypes: ['QUERIES'],
      QueriesConfig: queriesConfig([pages]),
    }),
  );
  for (let delay = 1000; ; delay = Math.min(delay * 1.5, 5000)) {
    await new Promise((r) => setTimeout(r, delay));
    const first = await client.send(new GetDocumentAnalysisCommand({ JobId }));
    if (first.JobStatus === 'IN_PROGRESS') continue;
    if (first.JobStatus === 'FAILED' && first.StatusMessage === 'INVALID_REQUEST_PARAMETER' && pages !== '*') {
      throw new PageRangeError(`Page range ${pages} rejected`);
    }
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
    const isPdf = key.toLowerCase().endsWith('.pdf');
    // Counted up front so each document gets the right call; null if the PDF can't be parsed.
    const pages = isPdf ? await countPages(bucket, key) : 1;
    logger.info('analyzing document', { pages });

    let blocks: Block[];
    if (pages !== null && pages > 1) {
      blocks = await analyzeAsync(bucket, key, Math.min(pages, MAX_PAGES));
    } else {
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
        // The sync API only takes single-page PDFs: Textract knew better than our count.
        if (!(err instanceof UnsupportedDocumentException) || !isPdf) throw err;
        blocks = await analyzeAsync(bucket, key, MAX_PAGES);
      }
    }
    return fromBlocks(blocks, key.split('/').pop() ?? key);
  },
};
