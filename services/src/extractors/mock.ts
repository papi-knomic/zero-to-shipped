import { toDayFirst } from '../lib/dates.ts';
import type { ExtractionResult, Extractor } from './types.ts';

// Deterministic, realistic results picked by filename keyword, with dates relative to today
// so the reminder windows (60/30/7 days) are always meaningful in demos.

/** Today ± n days as YYYY-MM-DD. */
function shift(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type Fixture = () => ExtractionResult;

const insurance: Fixture = () => {
  const effective = shift(-310);
  const expiry = shift(55);
  return {
    documentType: 'Insurance policy',
    title: 'Fire and Special Perils Insurance Policy',
    issuer: 'Leadway Assurance Company Limited',
    parties: ['Leadway Assurance Company Limited', 'Adebayo Foods Limited'],
    dates: [
      { label: 'effective', isoDate: effective, evidence: `Period of Insurance: From ${toDayFirst(effective)}`, confidence: 0.94 },
      { label: 'expiry', isoDate: expiry, evidence: `To ${toDayFirst(expiry)} (both days inclusive)`, confidence: 0.93 },
    ],
    validityPeriod: null,
    notes: 'Policy No. LAC/FSP/2025/004417. Sum insured ₦85,000,000.',
  };
};

const taxClearance: Fixture = () => {
  const issue = shift(-200);
  const expiry = `${issue.slice(0, 4)}-12-31`;
  return {
    documentType: 'Tax clearance certificate',
    title: 'Tax Clearance Certificate',
    issuer: 'Federal Inland Revenue Service',
    parties: ['Adebayo Foods Limited'],
    dates: [
      { label: 'issue', isoDate: issue, evidence: `Date of Issue: ${toDayFirst(issue)}`, confidence: 0.96 },
      { label: 'expiry', isoDate: expiry, evidence: `This certificate expires on ${toDayFirst(expiry)}`, confidence: 0.95 },
    ],
    validityPeriod: null,
    notes: 'TCC No. FIRS/TCC/2025/1180342. Covers the three preceding assessment years.',
  };
};

const tenancy: Fixture = () => {
  const effective = shift(-700);
  return {
    documentType: 'Contract',
    title: 'Tenancy Agreement — Shop 14, Allen Avenue, Ikeja',
    issuer: null,
    parties: ['Chief Olumide Bakare (Landlord)', 'Adebayo Foods Limited (Tenant)'],
    dates: [
      { label: 'effective', isoDate: effective, evidence: `commencing on the ${toDayFirst(effective)}`, confidence: 0.88 },
    ],
    validityPeriod: 'P2Y',
    notes: 'Term of two (2) years. Renewal subject to three months’ written notice.',
  };
};

const premisesPermit: Fixture = () => {
  const issue = shift(-340);
  const expiry = shift(25);
  return {
    documentType: 'Permit',
    title: 'Business Premises Registration Permit',
    issuer: 'Lagos State Ministry of Commerce, Cooperatives, Trade and Investment',
    parties: ['Adebayo Foods Limited'],
    dates: [
      { label: 'issue', isoDate: issue, evidence: `Issued: ${toDayFirst(issue)}`, confidence: 0.9 },
      { label: 'expiry', isoDate: expiry, evidence: `Valid until ${toDayFirst(expiry)}`, confidence: 0.89 },
    ],
    validityPeriod: null,
    notes: null,
  };
};

// Default: states a validity period instead of an expiry date, so expiry is computed in code.
const fireCertificate: Fixture = () => {
  const issue = shift(-360);
  return {
    documentType: 'Certificate',
    title: 'Fire Safety Certificate',
    issuer: 'Lagos State Fire and Rescue Service',
    parties: ['Adebayo Foods Limited'],
    dates: [{ label: 'issue', isoDate: issue, evidence: `Date of Issue: ${toDayFirst(issue)}`, confidence: 0.92 }],
    validityPeriod: 'P12M',
    notes: 'Valid for twelve (12) calendar months from the date of issue.',
  };
};

const FIXTURES: [RegExp, Fixture][] = [
  [/insur|policy/i, insurance],
  [/tax|tcc|firs/i, taxClearance],
  [/lease|tenan|contract|agreement/i, tenancy],
  [/permit|premises|licen[cs]e/i, premisesPermit],
];

export const mockExtractor: Extractor = {
  name: 'mock',
  async extract(_bucket: string, key: string): Promise<ExtractionResult> {
    await new Promise((resolve) => setTimeout(resolve, 1500)); // lets the UI show PROCESSING
    const filename = key.split('/').pop() ?? '';
    const fixture = FIXTURES.find(([pattern]) => pattern.test(filename))?.[1] ?? fireCertificate;
    return fixture();
  },
};
