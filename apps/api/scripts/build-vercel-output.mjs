/**
 * Vercel の Build Output API (v3) を手で組み立てる。
 *
 * なぜ: pnpm ワークスペースの `workspace:*` を npm が理解できないため、
 * Vercel 側で install を走らせると必ず失敗する。tsup が全依存を 1 ファイルに
 * 束ねているので install もビルドも不要 — 成果物だけを渡す。
 *
 * 使い方: pnpm --filter @coto2ba/api build && node scripts/build-vercel-output.mjs
 *         npx vercel deploy --prebuilt --prod
 */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, '.vercel', 'output')
const fn = join(out, 'functions', 'api', 'index.func')

const REGION = 'sin1'
const MAX_DURATION = 30
const RUNTIME = 'nodejs22.x'

await rm(out, { recursive: true, force: true })
await mkdir(fn, { recursive: true })
await mkdir(join(out, 'static'), { recursive: true })

await cp(join(root, 'api', 'index.mjs'), join(fn, 'index.mjs'))

await writeFile(
  join(fn, '.vc-config.json'),
  `${JSON.stringify(
    {
      runtime: RUNTIME,
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: true,
      supportsResponseStreaming: true,
      maxDuration: MAX_DURATION,
      regions: [REGION],
    },
    null,
    2,
  )}\n`,
)

// index.mjs は拡張子で ESM と判定されるが、明示しておくほうが安全
await writeFile(join(fn, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`)

await writeFile(
  join(out, 'config.json'),
  `${JSON.stringify(
    {
      version: 3,
      routes: [{ src: '/(.*)', dest: '/api/index' }],
    },
    null,
    2,
  )}\n`,
)

console.log(`Build Output API を書き出しました: ${out}`)
console.log('  npx vercel deploy --prebuilt --prod --yes  でデプロイできます')
