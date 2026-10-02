import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { pdfPageCount } from './pdf.ts';

async function makePdf(pages: number, useObjectStreams: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return doc.save({ useObjectStreams });
}

describe('pdfPageCount', () => {
  it('counts pages in a plain PDF', async () => {
    assert.equal(await pdfPageCount(await makePdf(3, false)), 3);
  });

  it('counts pages hidden in compressed object streams', async () => {
    const bytes = await makePdf(12, true);
    assert.doesNotMatch(Buffer.from(bytes).toString('latin1'), /\/Type\s*\/Page\b/); // invisible to a text search
    assert.equal(await pdfPageCount(bytes), 12);
  });

  it('returns null for something that is not a PDF', async () => {
    assert.equal(await pdfPageCount(new TextEncoder().encode('not a pdf')), null);
  });
});
