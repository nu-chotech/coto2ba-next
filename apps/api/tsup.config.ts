import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/main.ts' },
  outDir: 'api',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outExtension: () => ({ js: '.mjs' }),
  // ワークスペースのパッケージは必ずバンドルに取り込む
  // （Vercel 側で pnpm の symlink を解決できないため）
  noExternal: [/^@coto2ba\//],
  external: ['pg-native'],
  splitting: false,
  sourcemap: false,
  clean: true,
  minify: false,
  treeshake: true,
})
