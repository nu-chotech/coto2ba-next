/// <reference types="node" />
/**
 * ロゴのテスト。
 *
 * ロゴは横長（およそ 2.56:1）で、正方形の枠に入れると余白だらけになる。
 * 将来 "Next" を足したものに差し替わる予定なので、**同じファイル名で上書きすれば
 * 差し替わる**構造にしてある。比率が変わったらここで気づけるようにしておく。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOGO_ASPECT_RATIO } from '../src/components/constants'

const IMAGES_DIR = join(__dirname, '../assets/images')

/** PNG の IHDR は 16 バイト目から幅、20 バイト目から高さ。 */
function pngSize(name: string): [number, number] {
  const buf = readFileSync(join(IMAGES_DIR, name))
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)]
}

describe('ロゴ', () => {
  // 正方形の枠に入れると余白だらけになる。横長であることを固定しておく。
  it('横長の比率である', () => {
    expect(LOGO_ASPECT_RATIO).toBeGreaterThan(2)
  })

  it('実ファイルの比率と一致する', () => {
    const [width, height] = pngSize('logo-black.png')
    expect(LOGO_ASPECT_RATIO).toBeCloseTo(width / height, 2)
  })

  it('白と黒の 2 種類が同じ寸法である', () => {
    expect(pngSize('logo-black.png')).toEqual(pngSize('logo-white.png'))
  })
})
