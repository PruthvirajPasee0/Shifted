// Weekly ride recurrence helpers. Keeps the friendly UI (weekday chips +
// "repeat for N weeks") in sync with the RRULE string the backend parses:
//   FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=2026-08-15

export interface Weekday {
  code: string // iCal two-letter code
  short: string // single-letter chip label
  label: string // full name
  jsDay: number // JS Date.getDay(): Sun=0 … Sat=6
}

// Ordered Sunday → Saturday to match how calendars read left-to-right.
export const WEEKDAYS: Weekday[] = [
  { code: 'SU', short: 'S', label: 'Sunday', jsDay: 0 },
  { code: 'MO', short: 'M', label: 'Monday', jsDay: 1 },
  { code: 'TU', short: 'T', label: 'Tuesday', jsDay: 2 },
  { code: 'WE', short: 'W', label: 'Wednesday', jsDay: 3 },
  { code: 'TH', short: 'T', label: 'Thursday', jsDay: 4 },
  { code: 'FR', short: 'F', label: 'Friday', jsDay: 5 },
  { code: 'SA', short: 'S', label: 'Saturday', jsDay: 6 },
]

const CODE_BY_JS_DAY: Record<number, string> = Object.fromEntries(
  WEEKDAYS.map((w) => [w.jsDay, w.code]),
)

export const MAX_OCCURRENCES = 60

/** iCal weekday code for a JS Date (used to default the picker to the start day). */
export function codeForDate(d: Date): string {
  return CODE_BY_JS_DAY[d.getDay()]
}

/** Sort a set of weekday codes into calendar order (Sun→Sat). */
export function sortDays(days: string[]): string[] {
  const order = new Map(WEEKDAYS.map((w, i) => [w.code, i]))
  return [...days].sort((a, b) => (order.get(a) ?? 9) - (order.get(b) ?? 9))
}

function toIsoDate(d: Date): string {
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

/** Build the RRULE string for the given weekdays + horizon in weeks. */
export function buildRRule(days: string[], weeks: number, start: Date): string {
  const until = new Date(start)
  until.setDate(until.getDate() + weeks * 7)
  return `FREQ=WEEKLY;BYDAY=${sortDays(days).join(',')};UNTIL=${toIsoDate(until)}`
}

/**
 * Mirror of the backend generator so the UI can preview exactly what will be
 * created: the start departure is always first, then the selected weekdays up
 * to and including `start + weeks`.
 */
export function occurrenceDates(
  start: Date,
  days: string[],
  weeks: number,
): Date[] {
  if (!days.length) return [new Date(start)]
  const wanted = new Set(days)
  const until = new Date(start)
  until.setDate(until.getDate() + weeks * 7)

  const occ: Date[] = [new Date(start)]
  const cursor = new Date(start)
  cursor.setDate(cursor.getDate() + 1)
  while (cursor <= until && occ.length < MAX_OCCURRENCES) {
    if (wanted.has(CODE_BY_JS_DAY[cursor.getDay()])) occ.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return occ
}

/** Short human summary, e.g. "Mon, Wed, Fri". */
export function describeDays(days: string[]): string {
  return sortDays(days)
    .map((c) => WEEKDAYS.find((w) => w.code === c)?.label.slice(0, 3) ?? c)
    .join(', ')
}
