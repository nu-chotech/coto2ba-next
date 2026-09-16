/**
 * 結果画面まわりの導出（SPEC §8.4）。
 *
 * - tier のマスで表した経路（1 手 1 マス、`TIER_EMOJI`）
 * - シェア用のテキスト
 *
 * **画像のシェアは次の担当者**（`react-native-view-shot` + `expo-sharing`）。
 * ここではテキストだけ。
 */

import {
  ACHIEVEMENT_BY_ID,
  ACHIEVEMENT_IDS,
  type AchievementId,
  type GameDetail,
  LANDING_URL,
  TIER_EMOJI,
} from '@coto2ba/contracts'

/** 1 手 1 マス。⬜ mono / 🟩 color / 🟦 cosmos / 🟨 gold */
export function tierPath(game: GameDetail): string[] {
  return game.moves.map((move) => TIER_EMOJI[move.tier])
}

/** `9/17` の形。デイリーなら daily_date、フリーなら作成日。 */
export function shortDate(game: GameDetail): string {
  const source = game.daily_date ?? game.created_at
  const date = new Date(source)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}/${date.getDate()}`
}

/**
 * シェアのテキスト（SPEC §8.4）。
 *
 * ```
 * コトコトバ 9/17 ⬜⬜🟩🟩🟦🟨
 * 6手でクリア（ヒント1）
 * https://coto2ba-next.chotech.dev
 * ```
 */
export function shareText(game: GameDetail): string {
  const head = `コトコトバ ${shortDate(game)} ${tierPath(game).join('')}`.trim()
  const cleared = game.status === 'cleared'
  const body = cleared
    ? `${game.move_count}手で${game.perfect ? '完全錬成' : 'クリア'}（ヒント${game.hint_count}）`
    : `${game.move_count}手でギブアップ（ヒント${game.hint_count}）`
  return `${head}\n${body}\n${LANDING_URL}`
}

/** クエリ文字列に載せた実績 id を安全に読み戻す。 */
export function parseAchievementIds(raw: string | undefined): AchievementId[] {
  if (raw === undefined || raw.length === 0) return []
  const known = new Set<string>(ACHIEVEMENT_IDS)
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is AchievementId => known.has(part))
}

export function achievementTitle(id: AchievementId): string {
  return ACHIEVEMENT_BY_ID[id].title
}

export function achievementDescription(id: AchievementId): string {
  return ACHIEVEMENT_BY_ID[id].description
}
