const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DURATION = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/;

export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.toISOString().slice(0, 10) === value;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Adds an ISO 8601 date duration (PnYnMnWnD) to a YYYY-MM-DD date.
 * Month arithmetic clamps to the end of the month: 2025-01-31 + P1M = 2025-02-28.
 */
export function addIsoDuration(isoDate: string, duration: string): string {
  if (!isIsoDate(isoDate)) throw new Error(`Invalid ISO date: ${isoDate}`);
  const d = ISO_DURATION.exec(duration);
  if (!d || duration === 'P') throw new Error(`Unsupported ISO duration: ${duration}`);

  const [years, months, weeks, days] = [d[1], d[2], d[3], d[4]].map((v) => Number(v ?? 0)) as [
    number,
    number,
    number,
    number,
  ];
  const [y, m, day] = isoDate.split('-').map(Number) as [number, number, number];

  const totalMonths = (m - 1) + months + years * 12;
  const targetYear = y + Math.floor(totalMonths / 12);
  const targetMonth = totalMonths % 12;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));

  const result = new Date(Date.UTC(targetYear, targetMonth, targetDay + weeks * 7 + days));
  return result.toISOString().slice(0, 10);
}

/** Formats YYYY-MM-DD as DD/MM/YYYY (how the documents we target print dates). */
export function toDayFirst(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}
