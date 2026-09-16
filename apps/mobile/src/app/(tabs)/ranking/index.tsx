/**
 * ランキング（プレースホルダ）。
 * デイリーランキング（SPEC §5.8）は次の担当者が実装する。
 */

import { PlaceholderState, TierBackground } from '../../../components'

export default function RankingScreen() {
  return (
    <TierBackground tier="mono">
      <PlaceholderState
        title="ランキング"
        description="デイリーの上位 50 位と自分の順位が並びます。準備中です。"
      />
    </TierBackground>
  )
}
