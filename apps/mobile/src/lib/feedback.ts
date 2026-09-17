/**
 * ハプティクス + 効果音（SPEC §8.6）。
 *
 * **イベント名 → (haptic, sound) の対応表はこのファイルの `FEEDBACK_MAP` ただ 1 つ。**
 * UI はイベント名だけを呼ぶ（`feedback('tier_up')`）。UI 側で expo-haptics を
 * 直接呼ばないこと。
 *
 * - 効果音は `assets/sounds/` に自作の合成音 10 本が入っている
 *   （`pnpm pipeline:sounds` で生成、外部素材ゼロ）。`sounds.ts` の
 *   `SOUND_MODULES` に未登録の音があっても落ちない（無音、ログも出さない）。
 * - iOS のサイレントスイッチを尊重する（`playsInSilentMode: false`）。展示会場で
 *   鳴り続けるのを避けるため、これは「ゲームだから鳴らす」より優先する。
 * - 設定（zustand）の soundEnabled / hapticsEnabled と連動する。
 */

import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio'
import * as Haptics from 'expo-haptics'
import { Platform } from 'react-native'
import { useSettingsStore } from '../store/settings'
import { CLEAR_HAPTIC_DELAY_MS, PERFECT_HAPTIC_DELAY_MS, SOUND_VOLUME } from './constants'
import { SOUND_IDS, SOUND_MODULES, type SoundId } from './sounds'

export const FEEDBACK_EVENTS = [
  'slider_detent',
  'mix_start',
  'result_closer',
  'result_farther',
  'tier_up',
  'tier_down',
  'clear',
  'perfect',
  'hint_open',
  'error_oov',
  'achievement',
] as const

export type FeedbackEvent = (typeof FEEDBACK_EVENTS)[number]

type HapticStep =
  | { kind: 'selection'; delayMs?: number }
  | { kind: 'impact'; style: Haptics.ImpactFeedbackStyle; delayMs?: number }
  | { kind: 'notification'; type: Haptics.NotificationFeedbackType; delayMs?: number }

type FeedbackSpec = {
  haptics: readonly HapticStep[]
  sound: SoundId | null
}

const impact = (style: Haptics.ImpactFeedbackStyle, delayMs?: number): HapticStep => ({
  kind: 'impact',
  style,
  delayMs,
})
const notify = (type: Haptics.NotificationFeedbackType, delayMs?: number): HapticStep => ({
  kind: 'notification',
  type,
  delayMs,
})
const selection = (): HapticStep => ({ kind: 'selection' })

/** SPEC §8.6 の表をそのまま写したもの。ここだけを編集する。 */
export const FEEDBACK_MAP = {
  slider_detent: { haptics: [selection()], sound: 'detent' },
  mix_start: { haptics: [impact(Haptics.ImpactFeedbackStyle.Medium)], sound: 'mix' },
  result_closer: { haptics: [impact(Haptics.ImpactFeedbackStyle.Light)], sound: 'closer' },
  result_farther: { haptics: [impact(Haptics.ImpactFeedbackStyle.Soft)], sound: 'farther' },
  tier_up: {
    haptics: [notify(Haptics.NotificationFeedbackType.Success)],
    sound: 'tier_up',
  },
  tier_down: { haptics: [impact(Haptics.ImpactFeedbackStyle.Rigid)], sound: null },
  clear: {
    haptics: [
      notify(Haptics.NotificationFeedbackType.Success),
      impact(Haptics.ImpactFeedbackStyle.Heavy, CLEAR_HAPTIC_DELAY_MS),
    ],
    sound: 'clear',
  },
  perfect: {
    haptics: [
      notify(Haptics.NotificationFeedbackType.Success),
      impact(Haptics.ImpactFeedbackStyle.Heavy, CLEAR_HAPTIC_DELAY_MS),
      impact(Haptics.ImpactFeedbackStyle.Heavy, PERFECT_HAPTIC_DELAY_MS),
      impact(Haptics.ImpactFeedbackStyle.Heavy, PERFECT_HAPTIC_DELAY_MS),
    ],
    sound: 'perfect',
  },
  hint_open: { haptics: [selection()], sound: 'page' },
  error_oov: { haptics: [notify(Haptics.NotificationFeedbackType.Error)], sound: 'error' },
  achievement: { haptics: [notify(Haptics.NotificationFeedbackType.Success)], sound: 'badge' },
} as const satisfies Record<FeedbackEvent, FeedbackSpec>

// ── 再生 ────────────────────────────────────────────────────

const players = new Map<SoundId, AudioPlayer>()
let initialized = false

/**
 * 起動時に 1 度だけ呼ぶ。オーディオセッションを設定し、存在する SE をプリロードする。
 * 失敗しても投げない。
 */
export async function initFeedback(): Promise<void> {
  if (initialized) return
  initialized = true

  try {
    await setAudioModeAsync({
      // iOS のサイレントスイッチを尊重する。
      playsInSilentMode: false,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
    })
  } catch {
    // オーディオセッションが張れなくても SE 以外は動く。
  }

  for (const id of SOUND_IDS) {
    const module = SOUND_MODULES[id]
    if (module === undefined) continue
    try {
      const player = createAudioPlayer(module)
      player.volume = SOUND_VOLUME
      players.set(id, player)
    } catch {
      // この音だけ無音にする。
    }
  }
}

function playSound(id: SoundId | null): void {
  if (id === null) return
  if (!useSettingsStore.getState().soundEnabled) return
  const player = players.get(id)
  if (player === undefined) return
  try {
    // 同じ音を連打しても頭から鳴らす。
    void player.seekTo(0).then(() => {
      player.play()
    })
  } catch {
    // 再生できなくても UI は止めない。
  }
}

function runHaptic(step: HapticStep): void {
  if (Platform.OS === 'web') return
  try {
    if (step.kind === 'selection') void Haptics.selectionAsync()
    else if (step.kind === 'impact') void Haptics.impactAsync(step.style)
    else void Haptics.notificationAsync(step.type)
  } catch {
    // ハプティクス非対応端末。
  }
}

function playHaptics(steps: readonly HapticStep[]): void {
  if (!useSettingsStore.getState().hapticsEnabled) return
  let elapsed = 0
  for (const step of steps) {
    const delay = step.delayMs ?? 0
    elapsed += delay
    if (elapsed === 0) runHaptic(step)
    else setTimeout(() => runHaptic(step), elapsed)
  }
}

/**
 * イベントを 1 つ鳴らす。UI からはこれだけを呼ぶ。
 * 同期関数（await しない）。
 */
export function feedback(event: FeedbackEvent): void {
  const spec = FEEDBACK_MAP[event]
  playHaptics(spec.haptics)
  playSound(spec.sound)
}

/** rank の変化から `result_closer` / `result_farther` を選ぶ。 */
export function feedbackForRankChange(prevRank: number, nextRank: number): void {
  feedback(nextRank < prevRank ? 'result_closer' : 'result_farther')
}

/** 設定画面などでプレイヤーを解放する。 */
export function releaseFeedback(): void {
  for (const player of players.values()) {
    try {
      player.remove()
    } catch {
      // 解放済み。
    }
  }
  players.clear()
  initialized = false
}
