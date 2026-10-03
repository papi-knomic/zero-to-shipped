import { isIsoDate } from '../lib/dates.ts';
import { tidyCase } from './parse.ts';

// Machine-readable zone (ICAO 9303): the <<< lines on passports (TD3: 2 × 44) and ID cards
// (TD1: 3 × 30). Fixed positions and check digits, so the expiry date is read exactly or not at
// all. Date of birth and document number are in there too; they're deliberately not returned.

export interface Mrz {
  kind: 'passport' | 'id-card';
  issuingState: string;
  holder: string;
  expiryDate: string;
}

const STATES: Record<string, string> = {
  NGA: 'Federal Republic of Nigeria',
  GHA: 'Republic of Ghana',
  GBR: 'United Kingdom',
  USA: 'United States of America',
  CAN: 'Canada',
  ZAF: 'Republic of South Africa',
  KEN: 'Republic of Kenya',
};

/** ICAO 7-3-1 check digit: digits as themselves, A–Z as 10–35, < as 0. */
export function checkDigit(field: string): number {
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    const c = field[i]!;
    const value = c === '<' ? 0 : /\d/.test(c) ? +c : c.charCodeAt(0) - 55;
    sum += value * [7, 3, 1][i % 3]!;
  }
  return sum % 10;
}

const valid = (field: string, digit: string) => /\d/.test(digit) && checkDigit(field) === +digit;

/** YYMMDD expiry → ISO. Documents expire within this century; check digits already passed. */
function expiry(yymmdd: string): string | null {
  const value = `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
  return isIsoDate(value) ? value : null;
}

/** "ERIKSSON<<ANNA<MARIA<<<" → "Anna Maria Eriksson". */
function holderName(field: string): string {
  const [surname = '', given = ''] = field.replace(/<+$/, '').split('<<');
  const name = `${given.replace(/</g, ' ')} ${surname.replace(/</g, ' ')}`.trim();
  return tidyCase(name);
}

/** OCR tidy-up: MRZ text has no spaces; « is a misread of <<, ‹ of <. */
const clean = (line: string) => line.replace(/\s+/g, '').replace(/«/g, '<<').replace(/‹/g, '<').toUpperCase();

export function readMrz(lines: string[]): Mrz | null {
  const candidates = lines.map(clean).filter((l) => /^[A-Z0-9<]{30,44}$/.test(l));

  for (let i = 0; i + 1 < candidates.length; i++) {
    const [l1, l2] = [candidates[i]!, candidates[i + 1]!];
    // TD3 (passport): line 2 holds expiry at 21–26 with its check digit at 27.
    if (l1.length === 44 && l2.length === 44 && /^P/.test(l1)) {
      const exp = l2.slice(21, 27);
      if (!valid(exp, l2[27]!)) continue;
      const expiryDate = expiry(exp);
      if (!expiryDate) continue;
      return { kind: 'passport', issuingState: stateName(l1.slice(2, 5)), holder: holderName(l1.slice(5)), expiryDate };
    }
    // TD1 (ID card): expiry at 8–13 of line 2, check digit at 14; name on line 3.
    if (l1.length === 30 && l2.length === 30 && /^[IAC]/.test(l1)) {
      const exp = l2.slice(8, 14);
      if (!valid(exp, l2[14]!)) continue;
      const expiryDate = expiry(exp);
      if (!expiryDate) continue;
      const l3 = candidates[i + 2]?.length === 30 ? candidates[i + 2]! : '';
      return { kind: 'id-card', issuingState: stateName(l1.slice(2, 5)), holder: holderName(l3), expiryDate };
    }
  }
  return null;
}

function stateName(code: string): string {
  const c = code.replace(/</g, '');
  return STATES[c] ?? c;
}
