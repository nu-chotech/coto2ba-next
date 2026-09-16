/**
 * `/` はタブの中のロビーへ送るだけ。
 * タブ本体は `(tabs)/_layout.tsx`（Native Tabs）。
 */

import { Redirect } from 'expo-router'
import { LOBBY_HREF } from '../features/game'

export default function Index() {
  return <Redirect href={LOBBY_HREF} />
}
