import { describe, expect, it } from 'vitest'
import { SOUND_IDS, SOUND_MODULES } from '../src/lib/sounds'

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
})
