/**
 * アイコン名の台帳のテスト。
 *
 * 「絵文字にフォールバックしていた」のが今回潰している問題そのものなので、
 * **代替に絵文字が混ざっていないこと**を機械で固定する。
 * 実績のアイコンは contracts が SF Symbols 名で持っているので、
 * そこに載っている名前が台帳から漏れていたら気づけるようにする。
 */

import { ACHIEVEMENTS } from '@coto2ba/contracts'
import { describe, expect, it } from 'vitest'
import { materialSymbolFor, SYMBOL_NAMES, SYMBOLS } from '../src/components/symbols'

/** 絵文字（Extended_Pictographic）。1 文字でも混ざっていたら不合格。 */
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u

/** 画面が新たに使う名前。増えたらここに足す。 */
const SCREEN_SYMBOLS = [
  'ellipsis.circle',
  'chevron.left',
  'chevron.right',
  'arrow.up',
  'arrow.down',
  'lightbulb',
  'square.and.arrow.up',
  'flag',
  'crown.fill',
  'checkmark',
] as const

describe('シンボルの台帳', () => {
  it('実績のアイコンがすべて登録されている', () => {
    for (const achievement of ACHIEVEMENTS) {
      expect(SYMBOL_NAMES).toContain(achievement.icon)
    }
  })

  it('画面で使う名前がすべて登録されている', () => {
    for (const name of SCREEN_SYMBOLS) {
      expect(SYMBOL_NAMES).toContain(name)
    }
  })

  it('SYMBOL_NAMES と SYMBOLS のキーが一致する', () => {
    expect([...SYMBOL_NAMES].sort()).toEqual(Object.keys(SYMBOLS).sort())
  })

  // ここが今回の本題。代替に絵文字を混ぜない。
  it('代替の名前に絵文字が混ざっていない', () => {
    for (const [name, material] of Object.entries(SYMBOLS)) {
      expect(PICTOGRAPHIC.test(name)).toBe(false)
      expect(PICTOGRAPHIC.test(material)).toBe(false)
    }
  })

  it('代替の名前が Material Symbols の命名（小文字と _ だけ）になっている', () => {
    for (const material of Object.values(SYMBOLS)) {
      expect(material).toMatch(/^[a-z0-9_]+$/)
    }
  })
})

describe('materialSymbolFor', () => {
  it('登録済みの名前には代替を返す', () => {
    expect(materialSymbolFor('sparkle')).toBe(SYMBOLS.sparkle)
  })

  it('知らない名前には null を返す（絵文字を返さない）', () => {
    expect(materialSymbolFor('no.such.symbol')).toBeNull()
  })
})
