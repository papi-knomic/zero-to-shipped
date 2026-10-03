import { isIsoDate } from '../lib/dates.ts';

// Text → structured values, in code (never trusted to a model). Dates are day-first by default,
// because the documents we target (Nigerian) print DD/MM/YYYY.

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const pad = (n: number) => String(n).padStart(2, '0');

function iso(y: number, m: number, d: number): string | null {
  const year = y < 100 ? 2000 + y : y;
  const value = `${year}-${pad(m)}-${pad(d)}`;
  return isIsoDate(value) ? value : null;
}

const PATTERNS: { re: RegExp; toIso: (m: RegExpExecArray) => string | null }[] = [
  // 2025-10-05
  { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, toIso: (m) => iso(+m[1]!, +m[2]!, +m[3]!) },
  // 05/10/2025, 5-10-2025, 05.10.25: day-first, unless the middle number can't be a month
  {
    re: /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g,
    toIso: (m) => {
      const [a, b, y] = [+m[1]!, +m[2]!, +m[3]!];
      return b > 12 && a <= 12 ? iso(y, a, b) : iso(y, b, a);
    },
  },
  // 5th October, 2025 · 5 Oct 2025 · 5th day of October 2025 · passports: 14 MAR /MARS 31
  {
    re: new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+day)?(?:\\s+of)?\\s+${MONTH}\\.?(?:\\s*/\\s*[A-Za-zÀ-ÿ]{3,9}\\.?)?,?\\s+(\\d{4}|\\d{2})\\b`,
      'gi',
    ),
    toIso: (m) => iso(+m[3]!, MONTHS[m[2]!.slice(0, 3).toLowerCase()]!, +m[1]!),
  },
  // October 5, 2025
  {
    re: new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'),
    toIso: (m) => iso(+m[3]!, MONTHS[m[1]!.slice(0, 3).toLowerCase()]!, +m[2]!),
  },
];

/** Every date in the text, in the order they appear. */
export function parseDates(text: string): string[] {
  const found: { index: number; value: string }[] = [];
  for (const { re, toIso } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const value = toIso(m as RegExpExecArray);
      if (value) found.push({ index: m.index ?? 0, value });
    }
  }
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.index - b.index)
    .map((f) => f.value)
    .filter((v) => !seen.has(v) && seen.add(v));
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, eighteen: 18, 'twenty-four': 24, thirty: 30, sixty: 60, ninety: 90,
};
const UNIT: Record<string, string> = { y: 'Y', m: 'M', w: 'W', d: 'D' };

/** "twelve (12) calendar months" → P12M, "a term of two (2) years" → P2Y, "90 days" → P90D. */
export function parseValidity(text: string): string | null {
  const words = Object.keys(NUMBER_WORDS).join('|');
  const re = new RegExp(
    `\\b(?:(\\d{1,3})|(${words}|an?))\\s*(?:\\(\\s*(\\d{1,3})\\s*\\))?\\s*(?:calendar\\s+)?(years?|yrs?|months?|weeks?|days?)\\b`,
    'i',
  );
  const m = re.exec(text);
  if (!m) return null;
  const word = m[2]?.toLowerCase();
  const n = m[3] ? +m[3] : m[1] ? +m[1] : word === 'a' || word === 'an' ? 1 : NUMBER_WORDS[word ?? ''];
  if (!n || n <= 0) return null;
  return `P${n}${UNIT[m[4]![0]!.toLowerCase()]}`;
}

const SMALL = new Set(['and', 'of', 'the', 'for', 'in', 'on', 'to', 'a', 'an', 'at', 'by']);
const ACRONYMS = new Set(['FIRS', 'CAC', 'NAFDAC', 'TCC', 'LASAA', 'LSFRS', 'VAT', 'TIN', 'PLC', 'LTD', 'NIS', 'SON', 'NCC']);

/** Title-cases SHOUTED text (common on official documents). Mixed-case text is left alone. */
export function tidyCase(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (!letters || letters !== letters.toUpperCase()) return t;
  return t
    .split(' ')
    .map((w, i) => {
      if (ACRONYMS.has(w.replace(/[^A-Z]/g, ''))) return w;
      const lower = w.toLowerCase();
      return i > 0 && SMALL.has(lower) ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/** A short category for the document, from its type/title text. */
export function documentCategory(text: string): string {
  const t = text.toLowerCase();
  if (/passport/.test(t)) return 'Passport';
  if (/insurance|assurance|\bpolicy\b/.test(t)) return 'Insurance policy';
  if (/tax clearance/.test(t)) return 'Tax clearance certificate';
  if (/invoice|\bbill\b/.test(t)) return 'Invoice';
  if (/tenancy|lease|agreement|contract/.test(t)) return 'Contract';
  if (/permit/.test(t)) return 'Permit';
  if (/licen[cs]e/.test(t)) return 'Licence';
  if (/certificat/.test(t)) return 'Certificate';
  if (/registration/.test(t)) return 'Registration';
  return 'Document';
}

const ORG_KEYWORDS: [RegExp, number][] = [
  [/\b(SERVICE|MINISTRY|COMMISSION|AUTHORITY|AGENCY|BUREAU|INSPECTORATE)\b/i, 3],
  [/\b(ASSURANCE|INSURANCE|BANK|COMPANY|CORPORATION|COUNCIL|BOARD|LIMITED|PLC)\b/i, 2],
  [/\b(GOVERNMENT|REPUBLIC|STATE)\b/i, 1],
];

/** Issuing body from the letterhead: the most specific organisation name in the first lines. */
export function issuerFromHeader(lines: string[]): string | null {
  let best: { line: string; score: number } | null = null;
  for (const line of lines.slice(0, 5)) {
    if (/^(between|and)\s/i.test(line)) continue; // contract party lines, not a letterhead
    const score = ORG_KEYWORDS.find(([re]) => re.test(line))?.[1] ?? 0;
    if (score > 0 && line.length <= 90 && (!best || score > best.score)) best = { line, score };
  }
  return best ? tidyCase(best.line) : null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** The document line an answer came from, so the UI can quote it as evidence. */
export function evidenceLine(lines: string[], answer: string): string {
  const a = norm(answer);
  return lines.find((l) => norm(l).includes(a)) ?? answer;
}

/** Contract parties: "BETWEEN Chief Olumide Bakare (the Landlord)" → "Chief Olumide Bakare (Landlord)". */
export function contractParties(lines: string[]): string[] {
  return lines.flatMap((l) => {
    const m = /^(?:between|and)\s+(.+?)\s*\((?:the\s+)?([a-z ]+)\)/i.exec(l.trim());
    return m ? [`${tidyCase(m[1]!)} (${tidyCase(m[2]!.trim()).replace(/^./, (c) => c.toUpperCase())})`] : [];
  });
}
