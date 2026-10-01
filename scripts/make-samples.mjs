// Generates realistic (fictional) Nigerian business documents as PDFs, for testing extraction and
// for the demo's "Load sample documents". Dates are relative to today so reminders are always
// meaningful. Usage: node scripts/make-samples.mjs [outDir]   (default: web/public/samples)
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] ?? path.join(import.meta.dirname, '..', 'web', 'public', 'samples');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const shift = (days) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};
const dmy = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
const ordinal = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
const long = (d) => `${ordinal(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}, ${d.getUTCFullYear()}`;
const addYear = (d) => {
  const e = new Date(d);
  e.setUTCFullYear(e.getUTCFullYear() + 1);
  e.setUTCDate(e.getUTCDate() - 1);
  return e;
};

/** Minimal single-page PDF: Helvetica text lines. [size, text] or [size, text, 'B'] for bold. */
function pdf(lines) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  let y = 790;
  const ops = ['BT'];
  for (const [size, text, weight] of lines) {
    if (text === '') {
      y -= size;
      continue;
    }
    ops.push(`/${weight === 'B' ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 56 ${y} Tm (${esc(text)}) Tj`);
    y -= size * 1.7;
  }
  ops.push('ET');
  const stream = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const fireIssue = shift(-360);
const insStart = shift(-310);
const insEnd = addYear(insStart);
const tccIssue = shift(-200);
const permitIssue = shift(-340);
const permitEnd = shift(25);
const leaseStart = shift(-700);

const samples = {
  'fire-safety-certificate.pdf': [
    [11, 'LAGOS STATE GOVERNMENT', 'B'],
    [11, 'LAGOS STATE FIRE AND RESCUE SERVICE'],
    [11, 'Alausa, Ikeja, Lagos'],
    [14, ''],
    [18, 'FIRE SAFETY CERTIFICATE', 'B'],
    [11, `Certificate No: LSFRS/FSC/IKJ/${fireIssue.getUTCFullYear()}/0472`],
    [11, ''],
    [11, 'This is to certify that the premises of'],
    [12, 'ADEBAYO FOODS LIMITED', 'B'],
    [11, 'Shop 14, Allen Avenue, Ikeja, Lagos'],
    [11, 'have been inspected and found to comply with the fire safety requirements'],
    [11, 'of the Lagos State Fire and Rescue Service Law.'],
    [11, ''],
    [11, `Date of Issue: ${dmy(fireIssue)}`],
    [11, 'This certificate is valid for twelve (12) calendar months from the date of issue.'],
    [11, ''],
    [11, 'Signed: Director, Fire Safety Inspectorate'],
  ],
  'fire-insurance-policy.pdf': [
    [11, 'LEADWAY ASSURANCE COMPANY LIMITED', 'B'],
    [11, '121/123 Funsho Williams Avenue, Iponri, Lagos'],
    [14, ''],
    [16, 'FIRE AND SPECIAL PERILS INSURANCE POLICY', 'B'],
    [11, 'SCHEDULE'],
    [11, `Policy Number: LAC/FSP/${insStart.getUTCFullYear()}/004417`],
    [11, 'The Insured: Adebayo Foods Limited'],
    [11, 'Business: Food processing and retail'],
    [11, 'Sum Insured: N85,000,000.00'],
    [11, `Period of Insurance: From ${dmy(insStart)} to ${dmy(insEnd)} (both days inclusive)`],
    [11, `Date of Issue: ${dmy(shift(-312))}`],
    [11, ''],
    [11, 'Renewal premium is payable on or before the expiry of the period of insurance.'],
  ],
  'tax-clearance-certificate.pdf': [
    [11, 'FEDERAL INLAND REVENUE SERVICE', 'B'],
    [11, 'Revenue House, Wuse Zone 5, Abuja'],
    [14, ''],
    [18, 'TAX CLEARANCE CERTIFICATE', 'B'],
    [11, `TCC Number: FIRS/TCC/${tccIssue.getUTCFullYear()}/1180342`],
    [11, 'Taxpayer: ADEBAYO FOODS LIMITED'],
    [11, 'TIN: 21458897-0001'],
    [11, ''],
    [11, 'This is to certify that the above-named taxpayer has paid all taxes due'],
    [11, 'for the three preceding years of assessment.'],
    [11, ''],
    [11, `Date of Issue: ${long(tccIssue)}`],
    [11, `This certificate expires on 31st December, ${tccIssue.getUTCFullYear()}.`],
  ],
  'business-premises-permit.pdf': [
    [11, 'LAGOS STATE MINISTRY OF COMMERCE, COOPERATIVES, TRADE AND INVESTMENT', 'B'],
    [14, ''],
    [16, 'BUSINESS PREMISES REGISTRATION PERMIT', 'B'],
    [11, `Permit No: BPR/IKJ/${permitIssue.getUTCFullYear()}/22981`],
    [11, 'Holder: Adebayo Foods Limited'],
    [11, 'Premises: Shop 14, Allen Avenue, Ikeja'],
    [11, 'Category: Retail (Food)'],
    [11, ''],
    [11, `Issued: ${dmy(permitIssue)}`],
    [11, `Valid until: ${dmy(permitEnd)}`],
    [11, 'Renew at least 30 days before expiry to avoid penalties.'],
  ],
  'shop-tenancy-agreement.pdf': [
    [16, 'TENANCY AGREEMENT', 'B'],
    [11, `THIS AGREEMENT is made this ${long(leaseStart)}`],
    [11, 'BETWEEN Chief Olumide Bakare (the Landlord)'],
    [11, 'AND Adebayo Foods Limited (the Tenant)'],
    [11, ''],
    [11, 'In respect of Shop 14, Allen Avenue, Ikeja, Lagos.'],
    [11, `1. The tenancy shall commence on ${dmy(leaseStart)} for a term of two (2) years.`],
    [11, '2. The rent is N3,600,000.00 per annum, payable in advance.'],
    [11, '3. Renewal is subject to three months written notice before the end of the term.'],
  ],
};

mkdirSync(outDir, { recursive: true });
for (const [name, lines] of Object.entries(samples)) {
  writeFileSync(path.join(outDir, name), pdf(lines));
  console.log('wrote', path.join(outDir, name));
}
