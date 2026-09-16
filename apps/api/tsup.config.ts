import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/main.ts' },
  outDir: 'api',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outExtension: () => ({ js: '.mjs' }),
  /**
   * すべて（ワークスペースの @coto2ba/* と npm の依存）をバンドルに取り込む。
   * Vercel 側で `npm install` を走らせると pnpm の `workspace:*` 指定で失敗するため、
   * 単一ファイルにして install を不要にする（vercel.json の installCommand も無効化）。
   */
  noExternal: [/.*/],
  external: ['pg-native', 'cloudflare:sockets'],
  /**
   * `pg` などの CJS 依存は実行時に require('events') のような動的 require を行う。
   * ESM バンドルにはグローバルの require が無いため esbuild のシムが
   * 「Dynamic require of "events" is not supported」で落ちる。
   * createRequire を定義しておくと esbuild の __require シムがそれを拾う。
   */
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __pathDirname } from 'node:path';",
      'const require = __createRequire(import.meta.url);',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __pathDirname(__filename);',
    ].join('\n'),
  },
  splitting: false,
  sourcemap: false,
  clean: true,
  minify: false,
  // treeshake は rollup の後処理を走らせ、banner の require を require$1 にリネームしてしまう
  treeshake: false,
})
