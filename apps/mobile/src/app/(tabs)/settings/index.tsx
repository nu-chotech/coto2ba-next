/**
 * 設定（プレースホルダ）。
 * 設定（SPEC §8.2 / §8.8）は次の担当者が実装する。
 */

import { PlaceholderState, TierBackground } from '../../../components'

export default function SettingsScreen() {
  return (
    <TierBackground tier="mono">
      <PlaceholderState
        title="設定"
        description="名前の変更・ブースモード・引き継ぎ QR・サウンドの設定が入ります。準備中です。"
      />
    </TierBackground>
  )
}
