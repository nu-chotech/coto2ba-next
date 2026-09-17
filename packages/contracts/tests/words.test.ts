/**
 * 語の正規化。サーバーと端末で **同じ結果** になることがこのモジュールの存在理由なので、
 * ここが仕様書がわりになる。
 */
import { describe, expect, it } from 'vitest'
import {
  hasDigit,
  hasJapaneseScript,
  isMorphologicalVariant,
  isValidDisplayNameLength,
  normalizeWord,
  sharesKanji,
} from '../src/words'

describe('normalizeWord', () => {
  it('前後の空白を落とす', () => {
    expect(normalizeWord('  流星  ')).toBe('流星')
  })

  it('内部の空白も落とす', () => {
    expect(normalizeWord('宇宙 飛行士')).toBe('宇宙飛行士')
    expect(normalizeWord('宇宙　飛行士')).toBe('宇宙飛行士') // 全角スペース
  })

  it('NFKC で全角英数を半角にする', () => {
    expect(normalizeWord('ＡＢＣ１２３')).toBe('ABC123')
  })

  it('NFKC で半角カナを全角にする', () => {
    expect(normalizeWord('ｶﾞﾝﾀﾞﾑ')).toBe('ガンダム')
  })

  it('冪等（2 回かけても変わらない）', () => {
    for (const raw of ['  宇宙 飛行士 ', 'ＡＢＣ', 'ｶﾞﾝﾀﾞﾑ', '流星']) {
      expect(normalizeWord(normalizeWord(raw))).toBe(normalizeWord(raw))
    }
  })

  it('空文字は空文字', () => {
    expect(normalizeWord('')).toBe('')
    expect(normalizeWord('   ')).toBe('')
  })
})

describe('hasJapaneseScript', () => {
  it.each(['流星', 'ひらがな', 'カタカナ', '々', 'ー'])('%s は日本語', (w) => {
    expect(hasJapaneseScript(w)).toBe(true)
  })

  it.each(['abc', '123', '!!!', ''])('%s は日本語でない', (w) => {
    expect(hasJapaneseScript(w)).toBe(false)
  })
})

describe('hasDigit', () => {
  it('数字を含むかを見る', () => {
    expect(hasDigit('第2次')).toBe(true)
    expect(hasDigit('流星')).toBe(false)
  })
})

describe('sharesKanji', () => {
  it('漢字を共有していれば true', () => {
    expect(sharesKanji('流星', '星座')).toBe(true)
  })

  it('共有していなければ false', () => {
    expect(sharesKanji('流星', '温泉')).toBe(false)
  })

  it('片方に漢字が無ければ false', () => {
    expect(sharesKanji('ひらがな', '流星')).toBe(false)
    expect(sharesKanji('流星', 'ラーメン')).toBe(false)
  })

  it('対称', () => {
    expect(sharesKanji('流星', '星座')).toBe(sharesKanji('星座', '流星'))
  })
})

describe('isMorphologicalVariant', () => {
  it('同じ語は変種', () => {
    expect(isMorphologicalVariant('流星', '流星')).toBe(true)
  })

  it('2 文字以上の接頭辞を共有すれば変種（居住地 / 居住）', () => {
    expect(isMorphologicalVariant('居住地', '居住')).toBe(true)
  })

  it('2 文字以上の接尾辞を共有すれば変種（居住者 / 移住者）', () => {
    expect(isMorphologicalVariant('居住者', '移住者')).toBe(true)
  })

  it('1 文字しか共有しないなら変種でない', () => {
    // 「住」だけの共有では落とさない。落としすぎるとヒントが枯れる。
    expect(isMorphologicalVariant('居住', '定住')).toBe(false)
  })

  it('無関係な語は変種でない', () => {
    expect(isMorphologicalVariant('流星', '味噌汁')).toBe(false)
  })

  it('短すぎて閾値に届かない場合は変種でない', () => {
    expect(isMorphologicalVariant('赤', '赤い')).toBe(false)
  })

  it('対称', () => {
    expect(isMorphologicalVariant('居住地', '居住')).toBe(isMorphologicalVariant('居住', '居住地'))
  })
})

describe('isValidDisplayNameLength', () => {
  it('コードポイント単位で数える（サロゲートペアを 1 文字とする）', () => {
    expect(isValidDisplayNameLength('👩‍🚀', 1, 12)).toBe(true)
    expect(isValidDisplayNameLength('𩸽', 1, 1)).toBe(true) // UTF-16 では 2 単位
  })

  it('範囲外は false', () => {
    expect(isValidDisplayNameLength('', 1, 12)).toBe(false)
    expect(isValidDisplayNameLength('あ'.repeat(13), 1, 12)).toBe(false)
  })
})
