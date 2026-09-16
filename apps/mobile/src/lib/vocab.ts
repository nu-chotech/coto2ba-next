/**
 * 端末側の語彙判定（SPEC §8.7）。
 *
 * `assets/vocab/input.txt`（1 行 1 語、UTF-8、ソート済み、約 1.5MB）を expo-asset で読み、
 * 起動時にバックグラウンドで `Set<string>` とソート済み配列を作る。
 * これで OOV の往復が無くなる。**サーバー側の判定は残す（最終権威）。**
 *
 * 正規化は必ず contracts の `normalizeWord` を通す。サーバーと 1 文字でもずれると
 * OOV の判定が食い違う。
 *
 * ファイルがまだ空（パイプライン未実行）のときは判定をスキップし、
 * `isKnownWord()` は常に true を返す。
 */

import { normalizeWord, SUGGEST_LIMIT } from '@coto2ba/contracts'
import { Asset } from 'expo-asset'
import { File } from 'expo-file-system'
import { useUiStore } from '../store/ui'
import { VOCAB_CHUNK_SIZE, VOCAB_PROGRESS_CHUNK_INTERVAL } from './constants'

// Metro は require を静的に解決するので、ファイルは（空でも）必ず存在させる。
// assets/vocab/README.md を参照。
const VOCAB_MODULE = require('../../assets/vocab/input.txt') as number

export type VocabStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

let status: VocabStatus = 'idle'
let words: string[] = []
let wordSet = new Set<string>()
let inflight: Promise<void> | null = null

function setProgress(value: number): void {
  useUiStore.getState().setVocabLoadProgress(Math.min(Math.max(value, 0), 1))
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

async function readVocabText(): Promise<string> {
  const asset = Asset.fromModule(VOCAB_MODULE)
  if (!asset.downloaded) await asset.downloadAsync()
  const uri = asset.localUri ?? asset.uri

  try {
    // expo-file-system の新しいクラス API（旧 API は 'expo-file-system/legacy'）。
    return await new File(uri).text()
  } catch {
    // web / dev サーバ直参照など File が使えない経路のフォールバック。
    const res = await fetch(uri)
    return await res.text()
  }
}

function isSorted(list: readonly string[]): boolean {
  for (let i = 1; i < list.length; i += 1) {
    const prev = list[i - 1] as string
    const cur = list[i] as string
    if (prev > cur) return false
  }
  return true
}

/**
 * 語彙をロードする。二重呼び出しは同じ Promise を返す。
 * 失敗しても投げない（語彙が無くてもゲームは成立する）。
 */
export function loadVocab(): Promise<void> {
  if (status === 'ready' || status === 'unavailable') return Promise.resolve()
  if (inflight !== null) return inflight

  status = 'loading'
  setProgress(0)

  inflight = (async () => {
    try {
      const text = await readVocabText()
      setProgress(0.2)

      const lines = text.split('\n')
      const nextWords: string[] = []
      const nextSet = new Set<string>()

      let chunkIndex = 0
      for (let i = 0; i < lines.length; i += VOCAB_CHUNK_SIZE) {
        const end = Math.min(i + VOCAB_CHUNK_SIZE, lines.length)
        for (let j = i; j < end; j += 1) {
          const line = (lines[j] as string).trim()
          if (line.length === 0) continue
          if (nextSet.has(line)) continue
          nextSet.add(line)
          nextWords.push(line)
        }
        chunkIndex += 1
        if (chunkIndex % VOCAB_PROGRESS_CHUNK_INTERVAL === 0) {
          setProgress(0.2 + 0.7 * (end / Math.max(lines.length, 1)))
          await yieldToUi()
        }
      }

      if (nextWords.length === 0) {
        // プレースホルダのまま。判定はスキップする。
        words = []
        wordSet = new Set()
        status = 'unavailable'
        setProgress(1)
        return
      }

      // 二分探索の前提。パイプラインはソート済みで吐くが、
      // JS の UTF-16 コードユニット順と一致する保証まではないので確認して直す。
      if (!isSorted(nextWords)) {
        nextWords.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      }

      words = nextWords
      wordSet = nextSet
      status = 'ready'
      setProgress(1)
    } catch {
      words = []
      wordSet = new Set()
      status = 'unavailable'
      setProgress(1)
    } finally {
      inflight = null
      useUiStore.getState().setVocabStatus(status)
    }
  })()

  return inflight
}

export function getVocabStatus(): VocabStatus {
  return status
}

export function getVocabSize(): number {
  return words.length
}

/** 語彙判定が有効か。無効なら UI は OOV 警告を出さない。 */
export function isVocabReady(): boolean {
  return status === 'ready'
}

/**
 * 入力語彙にあるか。
 * 語彙が未ロード / 未生成のときは **true**（サーバーに最終判定を任せる）。
 */
export function isKnownWord(raw: string): boolean {
  if (status !== 'ready') return true
  const word = normalizeWord(raw)
  if (word.length === 0) return false
  return wordSet.has(word)
}

/** ソート済み配列での lower bound（prefix 以上が現れる最初の位置）。 */
function lowerBound(prefix: string): number {
  let lo = 0
  let hi = words.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((words[mid] as string) < prefix) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * 前方一致のサジェスト（二分探索）。
 * 語彙が無いときは空配列（チップを出さない）。
 */
export function suggest(prefix: string, limit: number = SUGGEST_LIMIT): string[] {
  if (status !== 'ready') return []
  const normalized = normalizeWord(prefix)
  if (normalized.length === 0) return []

  const out: string[] = []
  for (let i = lowerBound(normalized); i < words.length && out.length < limit; i += 1) {
    const word = words[i] as string
    if (!word.startsWith(normalized)) break
    if (word !== normalized) out.push(word)
  }
  return out
}

/** テスト・語彙差し替え用。 */
export function resetVocabForTest(): void {
  words = []
  wordSet = new Set()
  status = 'idle'
  inflight = null
}
