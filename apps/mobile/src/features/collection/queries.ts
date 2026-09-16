/**
 * 図鑑のサーバー状態。
 *
 * **`GET /api/collection` がまだ動かない前提で書く。** 失敗しても
 * `buildSpaceScene(undefined, …)` がゴースト点だけの宇宙を返すので画面は成立する。
 */

import type { CollectionResponse } from '@coto2ba/contracts'
import { useQuery } from '@tanstack/react-query'
import { getCollection, getWordDetail } from '../../lib/api'
import { queryKeys } from '../../lib/queryClient'

export function useCollectionQuery() {
  return useQuery({
    queryKey: queryKeys.collection(),
    queryFn: ({ signal }) => getCollection(signal),
    // 図鑑が空でも画面は出る。何度もリトライして待たせない。
    retry: false,
  })
}

/** ボトムシート用（説明 + pos3 + 実コサインの近傍 5 語）。 */
export function useWordDetailQuery(word: string | null) {
  return useQuery({
    queryKey: queryKeys.wordDetail(word ?? ''),
    queryFn: ({ signal }) => getWordDetail(word ?? '', signal),
    enabled: word !== null && word.length > 0,
    retry: false,
  })
}

/** 「出会った語 128 / 経路 4 本」。データが無ければ null。 */
export function collectionSummary(data: CollectionResponse | undefined): string | null {
  if (data === undefined) return null
  return `出会った語 ${data.encounters.length.toLocaleString('ja-JP')} ・ 経路 ${data.cleared_paths.length}`
}
