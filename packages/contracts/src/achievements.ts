/** v1 の実績 12 個（SPEC §8.4）。判定はサーバー。 */
export const ACHIEVEMENTS = [
  { id: 'meet_10', title: '出会い 10', description: '10 語に出会った', icon: 'sparkle' },
  { id: 'meet_50', title: '出会い 50', description: '50 語に出会った', icon: 'sparkles' },
  { id: 'meet_100', title: '出会い 100', description: '100 語に出会った', icon: 'books.vertical' },
  { id: 'meet_500', title: '出会い 500', description: '500 語に出会った', icon: 'building.columns' },
  { id: 'reach_cosmos', title: '宇宙へ', description: 'ランク 300 以内に初到達', icon: 'moon.stars' },
  { id: 'reach_gold', title: '黄金', description: '初クリア', icon: 'crown' },
  { id: 'perfect', title: '完全錬成', description: 'ゴールの語そのものを錬成した', icon: 'seal' },
  { id: 'no_hint_clear', title: '独力', description: 'ヒントなしでクリア', icon: 'eye.slash' },
  { id: 'clear_5', title: '手際', description: '5 手以内でクリア', icon: 'bolt' },
  { id: 'streak_3', title: '三日坊主返上', description: 'デイリー 3 日連続クリア', icon: 'flame' },
  { id: 'streak_7', title: '一週間', description: 'デイリー 7 日連続クリア', icon: 'flame.fill' },
  { id: 'comeback', title: 'リベンジ', description: '前日ギブアップ → 翌日クリア', icon: 'arrow.uturn.up' },
] as const

export type AchievementId = (typeof ACHIEVEMENTS)[number]['id']
export const ACHIEVEMENT_IDS = ACHIEVEMENTS.map((a) => a.id) as readonly AchievementId[]

export const ACHIEVEMENT_BY_ID: Record<AchievementId, (typeof ACHIEVEMENTS)[number]> =
  Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a])) as Record<
    AchievementId,
    (typeof ACHIEVEMENTS)[number]
  >

/** 「出会った語」系の実績のしきい値。 */
export const MEET_THRESHOLDS = [
  { id: 'meet_10', count: 10 },
  { id: 'meet_50', count: 50 },
  { id: 'meet_100', count: 100 },
  { id: 'meet_500', count: 500 },
] as const satisfies readonly { id: AchievementId; count: number }[]

export const STREAK_THRESHOLDS = [
  { id: 'streak_3', days: 3 },
  { id: 'streak_7', days: 7 },
] as const satisfies readonly { id: AchievementId; days: number }[]
