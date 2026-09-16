/**
 * 効果音のアセット登録。
 *
 * **素材はまだ無い（SPEC §14 の TBD）。** Metro は `require()` を静的に解決するので、
 * 存在しないファイルを書くとバンドルごと落ちる。だから今は空のまま置いてある。
 *
 * `assets/sounds/` にファイルを置いたら、下の該当行のコメントを外すだけで鳴る。
 * イベントと音の対応表は `feedback.ts` 側（対応表は 1 箇所だけ）。
 */

export const SOUND_IDS = [
  'detent',
  'mix',
  'closer',
  'farther',
  'tier_up',
  'clear',
  'perfect',
  'page',
  'error',
  'badge',
] as const

export type SoundId = (typeof SOUND_IDS)[number]

/**
 * SoundId → `require()` のアセット ID。
 * 未登録（= ファイルが無い）ものは無音になる。ログも出さない。
 */
export const SOUND_MODULES: Partial<Record<SoundId, number>> = {
  // detent: require('../../assets/sounds/detent.m4a'),
  // mix: require('../../assets/sounds/mix.m4a'),
  // closer: require('../../assets/sounds/closer.m4a'),
  // farther: require('../../assets/sounds/farther.m4a'),
  // tier_up: require('../../assets/sounds/tier_up.m4a'),
  // clear: require('../../assets/sounds/clear.m4a'),
  // perfect: require('../../assets/sounds/perfect.m4a'),
  // page: require('../../assets/sounds/page.m4a'),
  // error: require('../../assets/sounds/error.m4a'),
  // badge: require('../../assets/sounds/badge.m4a'),
}
