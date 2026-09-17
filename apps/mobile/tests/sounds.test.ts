/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SOUND_IDS, SOUND_MODULES } from '../src/lib/sounds'

const SOUNDS_DIR = join(__dirname, '../assets/sounds')
const EXPECTED_SAMPLE_RATE = 44_100
const EXPECTED_CHANNELS = 1
const EXPECTED_BITS_PER_SAMPLE = 16

type WavInfo = {
  numChannels: number
  sampleRate: number
  bitsPerSample: number
  dataSize: number
}

/**
 * 最小限の WAV(RIFF/WAVE, PCM) ヘッダパーサ。チャンクを順に辿って fmt/data を拾う。
 *
 * `vitest.config.mts` は `require('*.wav')` をテスト環境でリテラル `0` にスタブする
 * ため（vite-node が生の Node `require` に委譲し、Vite の resolve/load を素通りする
 * 制約への対処）、`SOUND_MODULES[id]` の中身を見ても「登録行はあるが .wav の実体が
 * 無い／壊れている」は検出できない。ファイルシステムを直接読んで検証する。
 */
function readWavInfo(path: string): WavInfo {
  const buf = readFileSync(path)
  if (
    buf.length < 12 ||
    buf.toString('ascii', 0, 4) !== 'RIFF' ||
    buf.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error(`${path} は正しい WAV(RIFF/WAVE) ではありません`)
  }

  let offset = 12
  let fmt: { numChannels: number; sampleRate: number; bitsPerSample: number } | undefined
  let dataSize: number | undefined

  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)
    const body = offset + 8
    if (chunkId === 'fmt ') {
      fmt = {
        numChannels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      }
    } else if (chunkId === 'data') {
      dataSize = chunkSize
    }
    // チャンクは偶数バイト境界に揃う（奇数サイズなら 1 バイトパディングが入る）。
    offset = body + chunkSize + (chunkSize % 2)
  }

  if (!fmt || dataSize === undefined) {
    throw new Error(`${path} に fmt/data チャンクが見つかりません`)
  }
  return { ...fmt, dataSize }
}

describe('効果音の登録', () => {
  // 登録漏れは「その操作だけ無音」という気づきにくい形で出る。
  it('すべての SoundId にアセットが登録されている', () => {
    for (const id of SOUND_IDS) {
      expect(SOUND_MODULES[id], `${id} が未登録`).toBeDefined()
    }
  })

  it('登録されているのは SoundId だけ', () => {
    for (const key of Object.keys(SOUND_MODULES)) {
      expect(SOUND_IDS).toContain(key)
    }
  })

  it.each(SOUND_IDS)('%s.wav が実在し、44.1kHz/モノラル/16bit の妥当な WAV である', (id) => {
    const path = join(SOUNDS_DIR, `${id}.wav`)
    expect(existsSync(path), `${path} が無い（削除・リネームされていないか確認）`).toBe(true)

    const info = readWavInfo(path)
    expect(info.numChannels, `${id}.wav のチャンネル数`).toBe(EXPECTED_CHANNELS)
    expect(info.sampleRate, `${id}.wav のサンプリングレート`).toBe(EXPECTED_SAMPLE_RATE)
    expect(info.bitsPerSample, `${id}.wav のビット深度`).toBe(EXPECTED_BITS_PER_SAMPLE)
    expect(info.dataSize, `${id}.wav のフレーム数（データバイト数）`).toBeGreaterThan(0)
  })
})
