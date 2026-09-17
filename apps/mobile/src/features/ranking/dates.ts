/**
 * JST の日付（`YYYY-MM-DD`）の計算。
 *
 * サーバーは JST の日付でデイリーを切る（contracts の `DAILY_TZ`）。
 * 端末のタイムゾーンが何であっても同じ日付になる必要があるので、
 * **固定オフセット（+09:00）で計算する**。日本に夏時間は無い。
 */

import { JST_UTC_OFFSET_MINUTES } from './constants'

const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** `Date`（絶対時刻）→ JST での `YYYY-MM-DD`。 */
export function toJstDateString(at: Date = new Date()): string {
  const shifted = new Date(at.getTime() + JST_UTC_OFFSET_MINUTES * MS_PER_MINUTE)
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}

/** いまの JST の日付。 */
export function jstToday(): string {
  return toJstDateString()
}

/** `YYYY-MM-DD` として妥当か（存在しない日付も弾く）。 */
export function isValidDateString(value: string): boolean {
  const matched = DATE_PATTERN.exec(value)
  if (matched === null) return false
  const [, y = '', m = '', d = ''] = matched
  const time = Date.UTC(Number(y), Number(m) - 1, Number(d))
  if (Number.isNaN(time)) return false
  // 2026-02-31 のような繰り上がりを弾く。
  return toUtcMidnightDateString(time) === value
}

function toUtcMidnightDateString(time: number): string {
  const date = new Date(time)
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
}

function toUtcMidnight(dateString: string): number {
  const matched = DATE_PATTERN.exec(dateString)
  if (matched === null) return Number.NaN
  const [, y = '', m = '', d = ''] = matched
  return Date.UTC(Number(y), Number(m) - 1, Number(d))
}

/** `YYYY-MM-DD` を days 日ずらす。不正な入力はそのまま返す。 */
export function shiftDate(dateString: string, days: number): string {
  const time = toUtcMidnight(dateString)
  if (Number.isNaN(time)) return dateString
  return toUtcMidnightDateString(time + days * MS_PER_DAY)
}

/** a が b より後なら正、同じなら 0、前なら負。 */
export function compareDates(a: string, b: string): number {
  const ta = toUtcMidnight(a)
  const tb = toUtcMidnight(b)
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0
  return ta === tb ? 0 : ta < tb ? -1 : 1
}

/** その日付が JST の今日より後か（未来の日付は開けない）。 */
export function isFutureDate(dateString: string, today: string = jstToday()): boolean {
  return compareDates(dateString, today) > 0
}

/** 「9月17日（水）」の形。見出しに使う。 */
const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'] as const

export function formatJstDateLabel(dateString: string): string {
  const time = toUtcMidnight(dateString)
  if (Number.isNaN(time)) return dateString
  const date = new Date(time)
  const weekday = WEEKDAY_JA[date.getUTCDay()] ?? ''
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日（${weekday}）`
}

/** 「9/17」の形。チップのような狭いところで使う。 */
export function formatJstShortDate(dateString: string): string {
  const time = toUtcMidnight(dateString)
  if (Number.isNaN(time)) return dateString
  const date = new Date(time)
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`
}

/** 今日／昨日なら相対表現、それ以外は null。 */
export function relativeDateLabel(dateString: string, today: string = jstToday()): string | null {
  if (dateString === today) return '今日'
  if (dateString === shiftDate(today, -1)) return '昨日'
  return null
}

/** ISO 文字列 → JST の `HH:MM`。クリア時刻の表示に使う。壊れていたら空文字。 */
export function formatJstTime(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  const shifted = new Date(parsed.getTime() + JST_UTC_OFFSET_MINUTES * MS_PER_MINUTE)
  return `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`
}
