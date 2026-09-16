/**
 * 端末側だけで使う文字種の判定。
 *
 * サーバーと共有する語の正規化・スクリプト判定は **packages/contracts**（`normalizeWord` /
 * `hasJapaneseScript`）。ここに置くのは「IME の変換途中かどうか」を推し量るための、
 * UI 専用の判定だけ。contracts に昇格させるべきものを見つけたら親に報告すること。
 */

/**
 * ひらがな（と長音符・繰り返し記号）だけでできているか。
 *
 * 日本語 IME で「銀河系」を打つ途中は「ぎ」「ぎん」「ぎんが」… と、
 * ひらがなだけの未確定の読みが `onChangeText` に流れてくる。
 * これらは辞書（`assets/vocab/input.txt` は表記のある語）に無くて当然なので、
 * **辞書外の警告を出してはいけない**（ARCHITECTURE §5）。
 *
 * 範囲は U+3041–U+3096（小書きを含むひらがな）、U+309D–U+309E（ゝゞ）、
 * U+30FC（ー: 「らーめん」のように、ひらがなの語にも現れる）。
 * 空文字は false（「ひらがなだけ」とは言えない）。
 */
const HIRAGANA_ONLY = /^[ぁ-ゖゝゞー]+$/u

export function isAllHiragana(text: string): boolean {
  return HIRAGANA_ONLY.test(text)
}
