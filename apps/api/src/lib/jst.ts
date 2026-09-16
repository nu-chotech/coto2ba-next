import { DAILY_TZ } from '@coto2ba/contracts'

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DAILY_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** その瞬間の JST 日付を YYYY-MM-DD で返す。 */
export function jstDate(at: Date = new Date()): string {
  return formatter.format(at)
}

/** YYYY-MM-DD に日数を足す（JST の日付演算。UTC の境界に影響されない）。 */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

/** a が b より前の日付か。 */
export function isBefore(a: string, b: string): boolean {
  return a < b
}
