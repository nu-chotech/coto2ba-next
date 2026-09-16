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
