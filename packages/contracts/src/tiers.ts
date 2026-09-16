import { TIERS, type TierId } from './constants'

/** rank から演出帯を決める。TIERS の先頭から rank <= maxRank を満たす最初のもの。 */
export function tierForRank(rank: number): TierId {
  for (const tier of TIERS) {
    if (rank <= tier.maxRank) return tier.id
  }
  return 'mono'
}

/** 演出帯の序列。数値が大きいほどゴールに近い。 */
export const TIER_ORDER: Record<TierId, number> = {
  mono: 0,
  color: 1,
  cosmos: 2,
  gold: 3,
}

export function isTierUp(prev: TierId, next: TierId): boolean {
  return TIER_ORDER[next] > TIER_ORDER[prev]
}

export function isTierDown(prev: TierId, next: TierId): boolean {
  return TIER_ORDER[next] < TIER_ORDER[prev]
}
