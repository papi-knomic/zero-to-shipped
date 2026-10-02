import { PDFDocument } from 'pdf-lib';

/** Page count from the PDF's own page tree, or null if it can't be parsed. A real parser is needed:
 * most PDFs (Word, Google Docs, invoicing tools) keep their page objects in compressed streams. */
export async function pdfPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return doc.getPageCount();
  } catch {
    return null;
  }
}
