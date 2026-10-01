import { api } from './api';
import type { ConfirmedFields, DocumentRecord } from './types';

// Demo mode: the sample PDFs (scripts/make-samples.mjs, dates relative to the deploy day) go
// through the real pipeline: presigned upload → S3 → SQS → Textract. Two are then confirmed
// (reminders off) so the workspace shows a mix of statuses.
const SAMPLES = [
  { file: 'fire-safety-certificate.pdf', confirm: false },
  { file: 'business-premises-permit.pdf', confirm: false },
  { file: 'fire-insurance-policy.pdf', confirm: false },
  { file: 'tax-clearance-certificate.pdf', confirm: true },
  { file: 'shop-tenancy-agreement.pdf', confirm: true },
];

const EXTRACTION_TIMEOUT_MS = 120_000;

export type SampleProgress = { phase: 'uploading' | 'reading' | 'done'; done: number; total: number };

function fieldsFrom(doc: DocumentRecord): ConfirmedFields | null {
  const x = doc.extraction;
  const date = (label: string) => x?.dates.find((d) => d.label === label)?.isoDate ?? null;
  const expiryDate = date('expiry');
  if (!x || !expiryDate) return null;
  return {
    title: x.title,
    documentType: x.documentType,
    issuer: x.issuer,
    parties: x.parties,
    issueDate: date('issue') ?? date('effective'),
    expiryDate,
  };
}

async function waitForExtraction(id: string): Promise<DocumentRecord | null> {
  const deadline = Date.now() + EXTRACTION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const doc = await api.getDocument(id);
    if (doc.status === 'NEEDS_REVIEW' || doc.status === 'FAILED') return doc;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

export async function loadSampleDocuments(onProgress: (p: SampleProgress) => void): Promise<void> {
  const total = SAMPLES.length;
  let done = 0;
  onProgress({ phase: 'uploading', done, total });

  // One at a time: parallel uploads would burst past the account's small Lambda concurrency.
  const uploaded: ((typeof SAMPLES)[number] & { doc: DocumentRecord })[] = [];
  for (const s of SAMPLES) {
    const res = await fetch(`/samples/${s.file}`);
    if (!res.ok) throw new Error(`Sample ${s.file} is unavailable (${res.status})`);
    const file = new File([await res.blob()], s.file, { type: 'application/pdf' });
    uploaded.push({ ...s, doc: await api.uploadDocument(file) });
    onProgress({ phase: 'uploading', done: ++done, total });
  }

  done = 0;
  onProgress({ phase: 'reading', done, total });
  await Promise.all(
    uploaded.map(async ({ doc, confirm }) => {
      const extracted = await waitForExtraction(doc.docId);
      const fields = extracted && fieldsFrom(extracted);
      if (confirm && fields) await api.confirmDocument(doc.docId, fields, null);
      onProgress({ phase: 'reading', done: ++done, total });
    }),
  );
  onProgress({ phase: 'done', done: total, total });
}
