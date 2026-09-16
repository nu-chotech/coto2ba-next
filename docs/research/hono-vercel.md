# Deploying a Hono API to Vercel (Node.js runtime) from a pnpm/Turborepo monorepo, with headless project + Neon provisioning — as of 2026-09-17

## 要約

The landscape changed since the "hono/vercel + Next.js App Router" era. Vercel now has a **first-class Hono framework preset** (`vercel.com/docs/frameworks/backend/hono`, last updated 2026-08-10): you place a file at `app|index|server.{ts,js,…}` or `src/app|index|server.*` relative to the Root Directory and `export default app`. Vercel turns every Hono route into one Vercel Function on Fluid compute, with no build command, no output directory, and **no `vercel.json` rewrites at all**. `hono/vercel`'s `handle()` still exists and is unchanged in hono 4.13.8 — it is literally `(app) => (req) => app.fetch(req)`, a one-line wrapper whose only real job is to swallow the extra handler args so Hono doesn't mistake them for `env`. So yes, a plain `app.fetch` export works; Vercel's own React Router docs ship `export default app.fetch`. For an `api/`-directory function the documented Node.js signature is the Web Standard `export default { fetch(request) {…} }`.

The hard part is the monorepo, and here the zero-config preset is a trap. Vercel's TS compile for the Node runtime explicitly **does not support tsconfig `paths` mappings or project references**; the Hono preset runs **no build command by default**, so a `packages/contracts` that emits `dist/` is never built; and there are repeated 2025–2026 community reports of `buildCommand` being ignored for pnpm-monorepo backend presets, producing `Cannot find module` for workspace deps. Vercel shipped an opt-in fix (`VERCEL_EXPERIMENTAL_BACKENDS=1`, Jan 2026) that adds path-alias support and extensionless relative imports — but it is experimental. **Recommendation: option (b).** Bundle `apps/api` with tsup into a self-contained `apps/api/api/index.mjs`, set Framework Preset to "Other" (`"framework": null`), and let the catch-all rewrite route everything to it. Workspace resolution then happens on your machine/CI at build time, never at deploy time.

Region: Hobby **is** allowed to pick a custom region — it is limited to *one* region ("Hobby plans can select any single region"), default `iad1`. `hnd1` (Tokyo) is therefore legal on Hobby. But **Neon has no Tokyo region** — its AWS list is us-east-1/2, us-west-2, eu-central-1, eu-west-2, **ap-southeast-1 (Singapore)**, ap-southeast-2, sa-east-1. For a pgvector workload with several round trips per request, co-locating the function with the DB dominates: use **`sin1` + Neon `aws-ap-southeast-1`**, not `hnd1`.

Hobby limits: 300 s default *and* maximum duration, 2 GB / 1 vCPU, 250 MB uncompressed bundle, 4.5 MB request/response body, 30 000 concurrency, 1 concurrent build. Fluid compute is on by default for new projects and largely removes per-request cold starts by reusing warm instances; use `attachDatabasePool()` from `@vercel/functions` so `pg` clients are released before suspension.

CLI: **v58 is stale — latest is 59.19.0** (published 2026-09-16). Everything below is v59 syntax and matches v58. Project creation that also sets Root Directory is *not* possible via `vercel project add` (no `--root-directory` flag) — use `POST /v11/projects`. Neon can be provisioned with `vercel integration add neon --plan free -m region=… --format json` non-interactively, but the **first-ever** terms acceptance for an integration on a team requires a browser.


## 事実

- **[high]** Vercel has a native Hono framework preset: create a file at app/index/server.{js,cjs,mjs,ts,cts,mts} or src/app|index|server.* and `export default app`. Zero config — no build command, no output directory, no rewrites.
  - source: `https://vercel.com/docs/frameworks/backend/hono`
- **[high]** `hono/vercel`'s handle() is unchanged in hono 4.13.8 and is literally `const handle = (app) => (req) => app.fetch(req)` — verified by unpacking the npm tarball (package/dist/adapter/vercel/handler.js).
  - source: `npm pack hono@4.13.8 → dist/adapter/vercel/handler.js`
- **[high]** A plain `app.fetch` export is supported by Vercel — its own React Router docs ship `export default app.fetch` for a Hono server entrypoint.
  - source: `https://vercel.com/docs/frameworks/frontend/react-router`
- **[high]** For a function in the api/ directory the documented Node.js runtime signature is the Web Standard export: `export default { fetch(request: Request) { … } }`. Per-method exports (GET, POST) also work.
  - source: `https://vercel.com/docs/functions/runtimes/node-js`
- **[high]** Vercel compiles TypeScript directly for server entrypoints and files in /api. A root tsconfig.json is honoured EXCEPT for 'Path Mappings' (paths) and 'Project References' — both unsupported.
  - source: `https://vercel.com/docs/functions/runtimes/node-js`
- **[high]** An experimental build mode for Hono and Express (env var VERCEL_EXPERIMENTAL_BACKENDS=1, announced 2026-01-15) adds TypeScript path-alias support, extensionless relative imports, better ESM/CJS interop, and route-based log filtering.
  - source: `https://vercel.com/changelog/experimental-build-mode-hono-express`
- **[high]** Hobby is limited to a SINGLE function region but may choose any region: 'Hobby plans can select any single region.' Default is iad1. Pro = 5 regions, Enterprise = all.
  - source: `https://vercel.com/docs/functions/configuring-functions/region#limits and /docs/project-configuration/vercel-json#regions`
- **[high]** hnd1 = ap-northeast-1 Tokyo and sin1 = ap-southeast-1 Singapore are both valid Vercel function regions; hnd1 is therefore allowed on Hobby (as the single region).
  - source: `https://vercel.com/docs/regions#region-list`
- **[high]** Neon has NO Tokyo region. AWS regions are: aws-us-east-1, aws-us-east-2, aws-us-west-2, aws-eu-central-1, aws-eu-west-2, aws-ap-southeast-1 (Singapore), aws-ap-southeast-2 (Sydney), aws-sa-east-1. Region is fixed at project creation and cannot be changed.
  - source: `https://neon.com/docs/introduction/regions`
- **[high]** Vercel Functions on Hobby with Fluid compute: max duration 300s default AND 300s maximum (no extension); memory 2 GB / 1 vCPU max; bundle 250 MB uncompressed; concurrency auto-scales to 30,000; request/response body cap 4.5 MB.
  - source: `https://vercel.com/docs/functions/limitations`
- **[high]** Fluid compute is enabled by default for new projects and can be forced with `"fluid": true` in vercel.json; it reuses warm instances across requests, which is the main cold-start mitigation.
  - source: `https://vercel.com/docs/fluid-compute`
- **[high]** `attachDatabasePool(pool)` from @vercel/functions must be called right after creating a pg Pool under Fluid compute so idle clients are released before the function suspends.
  - source: `https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package`
- **[high]** Vercel CLI latest on npm is 59.19.0 (published 2026-09-16). There is no v58 'latest' tag; the canary tag is stuck at 51.7.0. Flag syntax below is identical across v58 and v59.
  - source: `npm view vercel version / dist-tags / time`
- **[high]** `vercel project add <name>` creates a project but has NO flag for Root Directory. `vercel project update` supports --framework/--build-command/--install-command/--output-directory but also has no --root-directory.
  - source: `https://vercel.com/docs/cli/project`
- **[high]** `POST /v11/projects` accepts name, framework (null = Other), rootDirectory, buildCommand, installCommand, outputDirectory, nodeVersion, environmentVariables[], serverlessFunctionRegion — creating a fully configured project in one headless call. `PATCH /v9/projects/{idOrName}` updates the same fields.
  - source: `https://vercel.com/docs/rest-api/reference/endpoints/projects/create-a-new-project`
- **[high]** `vercel link --yes --project <name>` links non-interactively; `--yes` alone would name the project after the current directory. VERCEL_ORG_ID/VERCEL_PROJECT_ID env vars work instead of linking in CI.
  - source: `https://vercel.com/docs/cli/link and https://vercel.com/docs/monorepos/monorepo-faq`
- **[high]** `vercel env add <name> <environment> [gitbranch]` reads the value from stdin (`printf '%s' "$V" | vercel env add ...`). Production/preview default to `sensitive`; `--force` overwrites without prompting; `--no-sensitive` opts out; development cannot be sensitive.
  - source: `https://vercel.com/docs/cli/env`
- **[high]** `vercel deploy --prod` deploys to production; the FIRST deployment of a new project is always production even without --prod. Useful CI flags: --yes, --archive=tgz, --force, --no-wait, --logs, --regions <r>, --target=<env>, --token, --scope, --cwd. stdout is always the deployment URL.
  - source: `https://vercel.com/docs/cli/deploy`
- **[high]** `vercel integration add neon` works non-interactively: -n/--name, -m/--metadata KEY=VALUE, -p/--plan, -e/--environment, --prefix, --no-connect, --no-env-pull, -F json. It installs the integration first if absent, connects the resource to the linked project, and runs `vercel env pull`.
  - source: `https://vercel.com/docs/cli/integration`
- **[high]** First-time acceptance of a marketplace integration's terms of service (and selecting a paid plan) pauses the CLI and requires a browser. `vercel integration accept-terms <slug>` explicitly requires an interactive terminal. Documented headless example: `vercel integration add neon -m region=us-east-1 --plan free`.
  - source: `https://vercel.com/kb/guide/using-coding-agents-to-procure-vercel-marketplace-integrations`
- **[high]** The Vercel-managed Neon integration injects DATABASE_URL (pooled/PgBouncer), DATABASE_URL_UNPOOLED, PGHOST, PGHOST_UNPOOLED, PGUSER, PGDATABASE, PGPASSWORD and legacy POSTGRES_* vars, and auto-creates a Neon branch per preview deployment. `neon login` does not work on a Vercel-managed account — use an API key.
  - source: `https://neon.com/docs/guides/vercel-managed-integration`
- **[high]** Fully headless Neon alternative: `POST https://console.neon.tech/api/v2/projects` with `Authorization: Bearer $NEON_API_KEY` and body {project:{name,region_id,pg_version}}; or neonctl (npm `neonctl` 4.18.0) with NEON_API_KEY env var and `--output json`. Generating the API key itself needs the console once.
  - source: `https://neon.com/docs/reference/api/get-started and https://neon.com/docs/manage/api-keys`
- **[high]** Monorepo: set Root Directory to apps/api and enable 'Include source files outside of the Root Directory in the Build Step' (default-on for projects created after 2020-08-27). Vercel auto-detects the install command and installs from the pnpm workspace root.
  - source: `https://vercel.com/docs/monorepos/monorepo-faq and https://vercel.com/docs/builds/configure-a-build`
- **[medium]** Multiple 2025–2026 reports of pnpm-monorepo + Hono on Vercel failing with module-not-found for workspace packages, and of custom buildCommand being ignored; the working fixes people report are prebuilding workspace packages with tsup, or bundling and using `vercel deploy --prebuilt`.
  - source: `https://community.vercel.com/t/module-not-found-when-deploying-hono-backend-to-vercel/21164 , https://github.com/AmanVarshney01/create-better-t-stack/issues/898 , https://community.vercel.com/t/buildcommand-ignored-in-pnpm-monorepo-with-turborepo/18299`
- **[high]** In vercel.json, `"framework": null` selects the "Other" preset; `functions` glob keys are paths relative to the Root Directory; `regions` takes an array of region ids; rewrites are evaluated after the filesystem check, so `public/` assets still win over a `/(.*)` catch-all.
  - source: `https://vercel.com/docs/project-configuration/vercel-json`
- **[high]** Vercel Functions name limit: max 128 characters including the path and extension, no spaces.
  - source: `https://vercel.com/docs/functions/limitations#functions-name`

## コード片

### apps/api/src/main.ts — the entrypoint (source; tsup bundles this into api/index.mjs)

```typescript
import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';

// Workspace package — tsup INLINES this, so Vercel never resolves it at deploy time.
import { API_PREFIX, MAX_MIX_WORDS } from '@coto2ba/contracts';

const app = new Hono();

app.use('*', logger());
app.use('*', cors());

// NOTE: a Vercel rewrite is internal — the function still sees the ORIGINAL
// request path. Define routes at their real public paths. Do NOT use
// app.basePath('/api') unless clients actually call /api/*.
app.get('/health', (c) => c.json({ ok: true, maxMixWords: MAX_MIX_WORDS }));

app.post(`${API_PREFIX}/mix`, async (c) => {
  const body = await c.req.json();
  // ...server-authoritative game logic lives in services/game.ts
  return c.json({ ok: true, echo: body });
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});

// Web Standard export — the signature @vercel/node documents for api/ files.
// handle(app) === (req: Request) => app.fetch(req)
export default { fetch: handle(app) };

```

### apps/api/tsup.config.ts — bundles workspace deps into a self-contained function

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  // src/main.ts (NOT src/index.ts / src/app.ts / src/server.ts — those names are
  // auto-detected by Vercel as framework/server entrypoints and would create a
  // duplicate function).
  entry: { index: 'src/main.ts' },
  outDir: 'api',              // -> apps/api/api/index.mjs, the Vercel Function
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outExtension: () => ({ js: '.mjs' }),

  // THE key line: inline every workspace package so there is zero workspace
  // resolution at deploy time. tsup externalizes `dependencies` by default.
  noExternal: [/^@coto2ba\//],

  // Leave npm deps external and let Vercel's node_modules tracing include them.
  // pg's optional native binding must never be bundled.
  external: ['pg-native'],

  splitting: false,
  sourcemap: false,
  clean: true,
  dts: false,
  minify: false,
});

```

### apps/api/vercel.json — complete file (Root Directory = apps/api)

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "buildCommand": "pnpm run build",
  "installCommand": null,
  "outputDirectory": "public",
  "fluid": true,
  "regions": ["sin1"],
  "functions": {
    "api/index.mjs": {
      "maxDuration": 30
    }
  },
  "rewrites": [
    { "source": "/(.*)", "destination": "/api/index" }
  ]
}
```

### apps/api/package.json — relevant parts

```json
{
  "name": "@coto2ba/api",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch --onSuccess \"echo built\" & vercel dev",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@coto2ba/contracts": "workspace:*",
    "@vercel/functions": "^3",
    "hono": "^4.13.8",
    "pg": "^8"
  },
  "devDependencies": {
    "tsup": "^8",
    "typescript": "^5"
  }
}
```

### apps/api/src/db.ts — pg pool that survives Fluid compute suspension

```typescript
import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';

// DATABASE_URL is the POOLED (PgBouncer) URL injected by the Neon integration.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3, // Fluid reuses instances; keep per-instance pools small
});

// Releases idle clients before the function suspends. Without this you leak
// connections across warm invocations.
attachDatabasePool(pool);

```

### apps/api/.gitignore + repo-root .vercelignore (keep the 250 MB bundle cap and upload size sane)

```bash
# apps/api/.gitignore
api/
.vercel/

# ---- repo-root .vercelignore ----
# CRITICAL for this repo: never upload the word2vec pipeline data to Vercel.
tools/pipeline/data
tools/pipeline/.venv
**/__pycache__
apps/mobile
.git
node_modules
**/*.test.ts

```

### scripts/vercel-bootstrap.sh — headless create + link + env + deploy (CLI v59; same flags in v58)

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${VERCEL_TOKEN:?export VERCEL_TOKEN (vercel tokens add / dashboard)}"
PROJECT="${PROJECT:-coto2ba-api}"
TEAM_QS=""   # for a team scope: TEAM_QS="?teamId=team_xxx"  and add --scope <slug>
VC="pnpm dlx vercel@59"
cd "$(git rev-parse --show-toplevel)"

# 1) Create the project WITH Root Directory in one shot.
#    `vercel project add <name>` cannot set rootDirectory, so use the REST API.
curl -sS -X POST "https://api.vercel.com/v11/projects${TEAM_QS}" \
  -H "Authorization: Bearer ${VERCEL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @- <<JSON | jq -r '.id // .error.message'
{
  "name": "${PROJECT}",
  "framework": null,
  "rootDirectory": "apps/api",
  "buildCommand": "pnpm run build",
  "installCommand": null,
  "outputDirectory": "public",
  "nodeVersion": "22.x",
  "serverlessFunctionRegion": "sin1"
}
JSON
# Already exists? Update instead:
#   curl -sS -X PATCH "https://api.vercel.com/v9/projects/${PROJECT}${TEAM_QS}" \
#     -H "Authorization: Bearer ${VERCEL_TOKEN}" -H 'Content-Type: application/json' \
#     -d '{"rootDirectory":"apps/api","framework":null,"serverlessFunctionRegion":"sin1"}'

# 2) Link the repo root (Root Directory is applied server-side).
$VC link --yes --project "$PROJECT" --token "$VERCEL_TOKEN"
# CI alternative, no .vercel dir needed:
#   export VERCEL_ORG_ID=team_xxx VERCEL_PROJECT_ID=prj_xxx

# 3) Env vars. Value comes from stdin; printf avoids a trailing newline.
#    Production/Preview default to `sensitive`; --force overwrites silently.
printf '%s' "${DATABASE_URL}" | \
  $VC env add DATABASE_URL production --force --token "$VERCEL_TOKEN"
printf '%s' "${DATABASE_URL}" | \
  $VC env add DATABASE_URL preview    --force --token "$VERCEL_TOKEN"
# development cannot be sensitive:
printf '%s' "${DATABASE_URL}" | \
  $VC env add DATABASE_URL development --force --token "$VERCEL_TOKEN"

# 4) Deploy to production. stdout is always the deployment URL.
URL=$($VC deploy --prod --yes --archive=tgz --token "$VERCEL_TOKEN")
echo "deployed: $URL"
curl -fsS "$URL/health" && echo "  <- health OK"

```

### Neon: path A — Vercel-managed (marketplace), mostly headless

```bash
# Must be run AFTER `vercel link`, from the linked directory.
# First-ever install of an integration on the team pops a browser for ToS.
# Run this once interactively, then it is scriptable forever after.

# Discover the exact metadata keys / plan ids this integration exposes:
vercel integration add neon --help

# Provision non-interactively. Singapore is the closest Neon region to Japan.
vercel integration add neon \
  --name coto2ba-db \
  --plan free \
  -m region=aws-ap-southeast-1 \
  -e production -e preview -e development \
  --format json

# Injects DATABASE_URL (pooled), DATABASE_URL_UNPOOLED, PGHOST, PGUSER,
# PGPASSWORD, PGDATABASE, POSTGRES_* — then runs `vercel env pull`.

vercel integration list --format json      # verify
vercel env pull apps/api/.env.local        # local dev values

```

### Neon: path B — fully headless via the Neon API (no marketplace, no browser after the API key exists)

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${NEON_API_KEY:?create once at https://console.neon.tech -> Account settings -> API keys}"

RESP=$(curl -sS -X POST "https://console.neon.tech/api/v2/projects" \
  -H "Authorization: Bearer ${NEON_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"project":{"name":"coto2ba","region_id":"aws-ap-southeast-1","pg_version":17}}')

POOLED=$(echo "$RESP" | jq -r '.connection_uris[0].connection_uri')
DIRECT=$(echo "$RESP"  | jq -r '.connection_uris[0].connection_parameters.host' )

# pgvector
psql "$POOLED" -c 'CREATE EXTENSION IF NOT EXISTS vector;'

for ENVT in production preview development; do
  printf '%s' "$POOLED" | vercel env add DATABASE_URL "$ENVT" --force --token "$VERCEL_TOKEN"
done

# Equivalent with the CLI (npm neonctl@4.18.0), NEON_API_KEY in env:
#   neonctl projects create --name coto2ba --region-id aws-ap-southeast-1 --output json
#   neonctl connection-string --project-id <id> --pooled --output json

```

### FALLBACK ONLY — zero-config Hono preset (use if you drop the workspace dep or prebuild it)

```typescript
// apps/api/src/index.ts  (Root Directory = apps/api, Framework Preset = Hono)
// No vercel.json rewrites needed at all; Vercel routes every path here.
import { Hono } from 'hono';

const app = new Hono();
app.get('/health', (c) => c.json({ ok: true }));

export default app;   // <- the preset's contract

/* apps/api/vercel.json for this variant:
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["sin1"],
  "functions": { "src/index.ts": { "maxDuration": 30 } }
}
And set VERCEL_EXPERIMENTAL_BACKENDS=1 as a project env var if you need
tsconfig `paths` aliases or extensionless relative imports to resolve.
*/
```


## リスク

- Vercel's zero-config TypeScript compile for the Node runtime does NOT support tsconfig `paths` mappings or project references. If apps/api imports `@coto2ba/contracts` via a tsconfig path alias and you rely on the Hono preset, the build fails or silently resolves wrong. Bundling with tsup (or VERCEL_EXPERIMENTAL_BACKENDS=1) is the fix.
- The Hono framework preset runs NO build command by default. If packages/contracts needs a `dist/` build, it will never be produced, and multiple 2025–2026 community reports say a custom `buildCommand` is ignored for backend presets in pnpm monorepos. This is the single biggest source of `Cannot find module` failures.
- DO NOT name the tsup source entry `src/index.ts`, `src/app.ts`, or `src/server.ts`. Vercel auto-detects those exact paths (relative to Root Directory) as Hono/Node server entrypoints and will deploy a SECOND function from the raw TypeScript, shadowing or conflicting with your bundle. Use `src/main.ts`.
- With Framework Preset = "Other", the output directory defaults to `public` if it exists, otherwise `.` — which would serve your entire apps/api source tree (including src/*.ts) as static files. Always create `apps/api/public/.gitkeep` and set `"outputDirectory": "public"`.
- hnd1 (Tokyo) is legal on Hobby, but Neon has no Tokyo region. Pinning the function to hnd1 while the DB sits in Singapore adds ~70 ms per DB round trip; a multi-query pgvector request pays that 2–4×. Pick sin1 to co-locate. Region is immutable on the Neon side once the project is created.
- `tsup` externalizes `dependencies` by default — without `noExternal: [/^@coto2ba\//]` the workspace package stays an unresolvable bare import in the output and you get the exact failure you were trying to avoid. Verify with `grep -c '@coto2ba' apps/api/api/index.mjs` (should be 0).
- Never bundle `pg-native`; keep it in tsup `external`. And do not let the repo-root `tools/pipeline/data` (word2vec vectors) reach the upload — add a `.vercelignore`. The function bundle cap is 250 MB uncompressed and Hobby gets 1 concurrent build.
- The first acceptance of a marketplace integration's terms on a team requires a browser; `vercel integration accept-terms` explicitly demands an interactive TTY. Budget one manual step, or use the Neon API path instead. Non-free plans additionally require a payment method on the Vercel account.
- `vercel env add` with no `--no-sensitive` stores production/preview values as `sensitive`, which means you can never read them back via `vercel env ls` or the dashboard. Keep DATABASE_URL in your own secret store too. Also: development env vars can never be sensitive, and mixing development with production/preview in one `env add` call errors out.
- CLI v58 is behind — npm `latest` is 59.19.0. Pin explicitly (`pnpm dlx vercel@59`) in CI so a background auto-update doesn't change flag behavior mid-project. Also note `--regions` requires a value: bare `vercel --regions` errors with `option requires argument`.
- Neither `vercel project add` nor `vercel project update` can set Root Directory. If you skip the REST API call, the project deploys from the repo root, Vercel detects nothing useful, and the build either fails or ships an empty static site.
- Hobby's max duration is a hard 300 s with no extension path, and there is no multi-region failover. Under Fluid compute a `pg` Pool without `attachDatabasePool()` leaks connections across warm invocations and will exhaust Neon's connection limit — use the pooled (PgBouncer) DATABASE_URL and keep `max` small.

## 結論

Take option (b): bundle apps/api with tsup into a self-contained `apps/api/api/index.mjs` and set Framework Preset to "Other". Do not rely on the zero-config Hono preset for this monorepo.

Concretely:
1. Root Directory = `apps/api`, Framework = `null` ("Other"), buildCommand = `pnpm run build`, installCommand = auto (Vercel installs from the pnpm workspace root; "Include files outside Root Directory" is on by default), outputDirectory = `public`.
2. Entry source `apps/api/src/main.ts` exporting `export default { fetch: handle(app) }` from `hono/vercel`. Keep `handle()` — it is a 1-line wrapper that strips Vercel's extra handler args so Hono doesn't misread them as `env`. `app.fetch` alone also works, but `handle()` costs nothing and is the documented adapter.
3. tsup with `noExternal: [/^@coto2ba\//]`, `external: ['pg-native']`, ESM, `.mjs`, outDir `api`. Workspace resolution happens at build time on your machine/CI; Vercel only ever sees one plain JS file plus traced npm deps. This sidesteps the tsconfig-`paths` limitation, the missing-build-command problem, and the ignored-`buildCommand` reports in one move.
4. `vercel.json` in apps/api: `regions: ["sin1"]`, `fluid: true`, `functions: { "api/index.mjs": { maxDuration: 30 } }`, `rewrites: [{ source: "/(.*)", destination: "/api/index" }]`.
5. Region: **sin1, not hnd1.** hnd1 is permitted on Hobby (single region, freely chosen), but Neon has no Tokyo region and the DB round trips dominate a pgvector workload. Create the Neon project in `aws-ap-southeast-1`.
6. Headless provisioning: `POST /v11/projects` (sets rootDirectory + region, which the CLI cannot) → `vercel link --yes --project <name>` → `printf '%s' "$VAL" | vercel env add NAME production --force` → `vercel deploy --prod --yes --archive=tgz`. Pin `vercel@59`.
7. Neon: do `vercel integration add neon --plan free -m region=aws-ap-southeast-1 --format json` once interactively (first-time ToS needs a browser), and it is fully scriptable thereafter with preview branching for free. If you need zero browser steps in CI from day one, use the Neon API with a `NEON_API_KEY` and set `DATABASE_URL` yourself — you lose per-preview branching but gain full automation.
8. Add a repo-root `.vercelignore` excluding `tools/pipeline/data` before the first deploy.

Escape hatch if Vercel's node_modules tracing ever misbehaves: run `vercel build` locally/in CI and `vercel deploy --prebuilt --archive=tgz --prod`, which removes Vercel's build step from the equation entirely.
