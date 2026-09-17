/**
 * 効果音のアセット登録。
 *
 * 素材は `tools/pipeline/scripts/11_sounds.py`（`pnpm pipeline:sounds`）で合成した
 * 44,100Hz モノラル 16bit WAV。全音を同じ倍音構成から作り、エンベロープと音高だけを
 * 変えて音色を統一してある（docs/superpowers/plans/2026-09-17-synth-sounds.md）。
 *
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
  detent: require('../../assets/sounds/detent.wav'),
  mix: require('../../assets/sounds/mix.wav'),
  closer: require('../../assets/sounds/closer.wav'),
  farther: require('../../assets/sounds/farther.wav'),
  tier_up: require('../../assets/sounds/tier_up.wav'),
  clear: require('../../assets/sounds/clear.wav'),
  perfect: require('../../assets/sounds/perfect.wav'),
  page: require('../../assets/sounds/page.wav'),
  error: require('../../assets/sounds/error.wav'),
  badge: require('../../assets/sounds/badge.wav'),
}
