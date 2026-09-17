import { randomBytes } from 'node:crypto'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** 紛らわしい文字を除いた大文字英数のランダム文字列（引き継ぎコード用）。 */
export function readableToken(length: number): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length]
  }
  return out
}

/** URL セーフなランダム文字列（端末トークン用）。 */
export function opaqueToken(length: number): string {
  return randomBytes(Math.ceil((length * 3) / 4))
    .toString('base64url')
    .slice(0, length)
}

export function pickRandom<T>(items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined
  return items[Math.floor(Math.random() * items.length)]
}

/**
 * 文字列 → 32bit の種（FNV-1a）。同じ文字列なら常に同じ値。
 */
function seedFrom(seed: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** mulberry32。種が同じなら同じ列を吐く小さな PRNG。 */
function mulberry32(state: number): () => number {
  let t = state
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let x = t
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 種から決まる並べ替え（Fisher-Yates）。**`Math.random()` を使わない。**
 *
 * ヒントの並びに使う。「ゴールに近い順」だと 1 位が常に勝ち確定の手になり、
 * 反射的に一番上を押されてしまうので崩す。ただし
 * `hint_cache` が `(goal, current)` でキャッシュされる以上、
 * **同じ盤面なら常に同じ並び**でなければならない（開き直すたびに変わると探し直しになるし、
 * 人によって並びが違うと不公平）。種に盤面を渡すことでその両立を保つ。
 *
 * 入力は破壊しない。
 */
export function deterministicShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items]
  const next = mulberry32(seedFrom(seed))
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    const a = out[i] as T
    const b = out[j] as T
    out[i] = b
    out[j] = a
  }
  return out
}
