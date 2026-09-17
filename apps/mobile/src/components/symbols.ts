/**
 * アイコン名の台帳。
 *
 * このアプリのアイコンは **SF Symbols 名が正**（実績は contracts が最初からそれで持っている）。
 * iOS ではその名前をそのまま `SymbolView` に渡す。
 *
 * iOS 以外（Android / Web）では SF Symbols が無いので、`expo-symbols` が同梱している
 * **Material Symbols のフォント**に載せ替える。`SymbolView` は `name` をオブジェクトで
 * 渡されたときだけプラットフォームごとの名前を見る（文字列だと iOS 以外は何も描かない）ので、
 * 対応表がここに要る。
 *
 * **絵文字にフォールバックしない。** 展示で「チープに見える」と言われた原因がそれなので、
 * 対応表に無い名前が来たら開発ビルドで警告し、本番では無害な点を描く（`SymbolIcon`）。
 *
 * ここは **React にも react-native にも依存しない**（テストから素直に読めるように）。
 */

import { ACHIEVEMENT_BY_ID, type AchievementId } from '@coto2ba/contracts'
import type { AndroidSymbol, SFSymbol } from 'expo-symbols'

/**
 * SF Symbols 名 → Material Symbols 名。
 *
 * 展示で使う名前だけを載せる（総当たりで用意しない）。
 * 画面に新しいアイコンを足すときは、**まずここに 1 行足す**。
 */
export const SYMBOLS = {
  // ── 実績 12 個（packages/contracts/src/achievements.ts の icon）──
  sparkle: 'auto_awesome',
  sparkles: 'auto_awesome',
  'books.vertical': 'menu_book',
  'building.columns': 'account_balance',
  'moon.stars': 'bedtime',
  crown: 'workspace_premium',
  seal: 'verified',
  'eye.slash': 'visibility_off',
  bolt: 'bolt',
  flame: 'local_fire_department',
  'flame.fill': 'local_fire_department',
  'arrow.uturn.up': 'u_turn_left',

  // ── 画面の操作 ──
  'ellipsis.circle': 'more_horiz',
  magnifyingglass: 'search',
  'chevron.left': 'chevron_left',
  'chevron.right': 'chevron_right',
  'arrow.up': 'arrow_upward',
  'arrow.down': 'arrow_downward',
  lightbulb: 'lightbulb',
  'square.and.arrow.up': 'ios_share',
  'doc.on.doc': 'content_copy',
  'arrow.up.right': 'open_in_new',
  flag: 'flag',
  'crown.fill': 'workspace_premium',
  checkmark: 'check',
} as const satisfies Partial<Record<SFSymbol, AndroidSymbol>>

/** 台帳に載っている SF Symbols 名。 */
export type SymbolName = keyof typeof SYMBOLS

export const SYMBOL_NAMES = Object.keys(SYMBOLS) as readonly SymbolName[]

/**
 * SF Symbols 名 → Material Symbols 名。載っていなければ `null`。
 * `null` のときに絵文字へ落とさないこと（`SymbolIcon` が点を描く）。
 */
export function materialSymbolFor(name: string): AndroidSymbol | null {
  return isSymbolName(name) ? SYMBOLS[name] : null
}

export function isSymbolName(name: string): name is SymbolName {
  return Object.hasOwn(SYMBOLS, name)
}

/**
 * 実績のアイコン名（contracts が SF Symbols 名で持っている）。
 *
 * 戻り値を `SymbolName` にしてあるので、**実績が増えて台帳から漏れると型エラーになる**。
 * 画面から `as` で押し込まないこと。
 */
export function achievementIcon(id: AchievementId): SymbolName {
  return ACHIEVEMENT_BY_ID[id].icon
}
