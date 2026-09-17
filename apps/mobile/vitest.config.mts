import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * Metro は `require('./foo.wav')` のようなアセット require を「アセット ID (number)」に
 * 変換して解決するが、vitest（vite-node）はそれを知らず、`require()` は Vite の
 * resolve/load パイプラインを通らず生の Node `require` に落ちるため、WAV バイナリを
 * そのまま JS として読もうとして構文エラーになる。
 *
 * `src/lib/sounds.ts` はテスト対象そのもの（`SOUND_MODULES` の require）なので、
 * ソース変換の段階で `require('*.wav')` をリテラル `0` に書き換える。
 * `tests/sounds.test.ts`（`SOUND_MODULES` のキー集合だけを見る。値の中身は見ない）
 * に必要な最小限のモックで、Metro 側の実際の変換ロジックには一切影響しない。
 */
function stubAssetRequires(): Plugin {
  const ASSET_REQUIRE_RE = /require\((['"])[^'"]*?\.(?:wav|mp3|m4a|png|jpg|jpeg|gif|ttf|otf)\1\)/g

  return {
    name: 'stub-asset-requires',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('src/lib/sounds.ts')) return null
      if (!ASSET_REQUIRE_RE.test(code)) return null
      ASSET_REQUIRE_RE.lastIndex = 0
      return { code: code.replace(ASSET_REQUIRE_RE, '0'), map: null }
    },
  }
}

export default defineConfig({
  plugins: [stubAssetRequires()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
