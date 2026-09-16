/**
 * 語の正規化。サーバーとクライアントで完全に同じ結果になる必要がある
 * （端末側の語彙判定とサーバー側の vocab 引き当てが一致しないと OOV が食い違う）。
 */

/**
 * trim → NFKC 正規化。
 * NFKC は全角英数 → 半角、半角カナ → 全角カナ、互換漢字の統合を含む。
 * 内部の空白も落とす（「宇宙 飛行士」→「宇宙飛行士」）。
 */
export function normalizeWord(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/gu, '').trim()
}

/** 日本語スクリプト（ひらがな・カタカナ・漢字）を 1 文字以上含むか。 */
const JAPANESE_SCRIPT = /[ぁ-ゟ゠-ヿ一-鿿㐀-䶿々〆ー]/u
export function hasJapaneseScript(word: string): boolean {
  return JAPANESE_SCRIPT.test(word)
}

const HAS_DIGIT = /[0-9]/u
export function hasDigit(word: string): boolean {
  return HAS_DIGIT.test(word)
}

/** 漢字を 1 文字以上共有するか（スタート語がゴールと似すぎるのを避ける粗い規則）。 */
const KANJI = /[一-鿿㐀-䶿]/gu
export function sharesKanji(a: string, b: string): boolean {
  const setA = new Set(a.match(KANJI) ?? [])
  if (setA.size === 0) return false
  for (const ch of b.match(KANJI) ?? []) {
    if (setA.has(ch)) return true
  }
  return false
}

/** 表示名として許容されるか（長さのみ。NG 語チェックはサーバー側）。 */
export function isValidDisplayNameLength(name: string, min: number, max: number): boolean {
  const len = [...name].length
  return len >= min && len <= max
}
