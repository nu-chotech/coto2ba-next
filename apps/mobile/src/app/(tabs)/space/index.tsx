/**
 * 図鑑（プレースホルダ）。
 * 3D の図鑑（SPEC §9）は次の担当者が Skia で実装する。
 */

import { PlaceholderState, TierBackground } from '../../../components'

export default function SpaceScreen() {
  return (
    <TierBackground tier="mono">
      <PlaceholderState
        title="図鑑"
        description="出会った語をベクトル空間に並べます。準備中です。"
      />
    </TierBackground>
  )
}
