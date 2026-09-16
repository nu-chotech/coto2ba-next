# Drizzle ORM + pgvector (halfvec) on Neon Postgres for a vector-search game backend — versions, driver choice, SQL, indexing, bulk load, Neon Free limits (verified 2026-09-17)

## 要約

All claims below marked "measured" were verified in this session by running a real `pgvector/pgvector:pg17` container (PG 17.11, pgvector 0.8.6) with 180,000 rows × `halfvec(200)`, 100,080 of them `is_output = true`, plus a real `drizzle-kit generate/migrate` run and a real drizzle+pg query run.

Versions: `drizzle-orm@0.45.2` and `drizzle-kit@0.31.10` are the current `latest` tags (both published 2026-03). A `1.0.0-rc.4` line exists under the `rc` tag — do not ship it. `pg@8.23.0`, `postgres@3.4.9`, `@neondatabase/serverless@1.1.0`, `pgvector` (npm) `0.3.0`, pgvector (server) `0.8.6`.

Driver: use **`pg` (node-postgres) 8.23 via `drizzle-orm/node-postgres`**, a module-scope `Pool` on the Neon `-pooler` host, wrapped in `attachDatabasePool()` from `@vercel/functions`, with Fluid Compute on. For 4-5 sequential round trips per request this is decisively the fastest and most reliable: the TCP connection is established once and reused across warm invocations, whereas `@neondatabase/serverless` HTTP pays a fresh HTTPS request *per query* (4-5 of them) and cannot do interactive transactions — which you need, since rule judging is server-side. `postgres-js` is rejected because it sends **named** prepared statements by default, which breaks under PgBouncer transaction pooling (you'd have to set `prepare: false`), and it isn't in Vercel's `attachDatabasePool` supported-client list. **Co-locate the Vercel function region with the Neon region** — this matters far more than driver choice.

halfvec: **natively supported**. `halfvec({ dimensions: 200 })` exists in `drizzle-orm/pg-core`; its runtime codec is `mapToDriverValue = JSON.stringify` / `mapFromDriverValue = parse '[a,b,c]'`, so you read/write plain `number[]`. I ran `drizzle-kit generate` and it emitted `"vec" halfvec(200) NOT NULL` unquoted plus `CREATE INDEX ... USING hnsw ("vec" halfvec_cosine_ops) WHERE "words"."is_output"` correctly — the old quoting bug (issue #4674, reported on 0.44.2) is fixed at 0.45.2/0.31.10. Postgres accepts the table-qualified predicate. A `customType` fallback is still provided below.

Query size: a 200-dim halfvec text literal is **2,408–2,420 bytes** (measured). Postgres caps a query string and each bind parameter at `MaxAllocSize` = 1 GB − 1, so this is a non-issue. Passing it as a **bound parameter is fine and the HNSW index is still used** — verified with `PREPARE ann(halfvec(200), text[])` → `Index Scan using words_vec_hnsw`.

Measured performance (fast local ARM core, so treat as a floor): exact rank query (seq scan 180k rows, cosine) **13–22 ms warm serial, 35–40 ms cold, 11.7 ms with 2 parallel workers**; ANN top-5 through the partial HNSW index with an exclusion list **1.5–7 ms**; partial HNSW build **30–34 s serial**, index 71 MB, table 82 MB; binary COPY of all 180k rows **0.45–0.93 s** with a **78.0 MB** wire payload vs **438 MB** for text COPY.

Neon Free: 0.5 GB storage/project, 100 CU-hours/project/month, autosuspend after 5 min (cannot be disabled), autoscale 0.25 → 2 CU, 5 GB egress/month. `maintenance_work_mem` defaults to **64 MB** at 0.25 CU — far below the ~225 MB this index needs. **There is no Tokyo (ap-northeast-1) region**; closest is `aws-ap-southeast-1` (Singapore).


## 事実

- **[high]** drizzle-orm latest = 0.45.2 (published 2026-03-27); drizzle-kit latest = 0.31.10 (published 2026-03-17). A 1.0.0-rc.4 exists under the 'rc' dist-tag and 1.0.0-beta.22 under 'beta'; neither is 'latest'.
  - source: `https://registry.npmjs.org/drizzle-orm + https://registry.npmjs.org/drizzle-kit (dist-tags + time fields, fetched 2026-09-17)`
- **[high]** Companion driver versions: pg 8.23.0, postgres (postgres-js) 3.4.9, @neondatabase/serverless 1.1.0, pgvector (npm) 0.3.0.
  - source: `npm registry dist-tags, fetched 2026-09-17`
- **[high]** drizzle-orm supports halfvec natively: `halfvec({dimensions:N})` is exported from drizzle-orm/pg-core. Verified in the 0.45.2 tarball at package/pg-core/columns/vector_extension/halfvec.js — getSQLType() returns `halfvec(${dimensions})`, mapToDriverValue is JSON.stringify(value), mapFromDriverValue does value.slice(1,-1).split(',').map(parseFloat). So the TS type is number[] in both directions.
  - source: `npm pack drizzle-orm@0.45.2, package/pg-core/columns/vector_extension/halfvec.js`
- **[high]** drizzle-kit 0.31.10 generates correct halfvec DDL. Running `drizzle-kit generate` on a schema with halfvec('vec',{dimensions:200}) and a partial HNSW index produced: `"vec" halfvec(200) NOT NULL` (unquoted) and `CREATE INDEX "words_vec_hnsw" ON "words" USING hnsw ("vec" halfvec_cosine_ops) WHERE "words"."is_output";`. The quoting bug in issue #4674 (reported against 0.44.2) is fixed.
  - source: `measured this session: drizzle-kit@0.31.10 generate; https://github.com/drizzle-team/drizzle-orm/issues/4674`
- **[high]** drizzle-kit's internal vectorOps allowlist only contains vector_l2_ops, vector_ip_ops, vector_cosine_ops, vector_l1_ops, bit_hamming_ops, bit_jaccard_ops, halfvec_l2_ops, sparsevec_l2_ops — but it is used ONLY to render an error message, and the mandatory-opclass check fires only for column type 'PgVector'. halfvec columns are type 'PgHalfVector', so .op('halfvec_cosine_ops') passes through verbatim.
  - source: `drizzle-kit@0.31.10 bin.cjs, src/extensions/vector.ts + pgSerializer index handling (inspected this session)`
- **[high]** Postgres accepts a table-qualified column in a partial index predicate: `CREATE INDEX words_vec_hnsw ON "words" USING hnsw ("vec" halfvec_cosine_ops) WHERE "words"."is_output";` succeeded and \d shows it normalized to `WHERE is_output`.
  - source: `measured this session, PostgreSQL 17.11 + pgvector 0.8.6`
- **[high]** A 200-dim halfvec rendered as text is 2,408-2,420 bytes. Postgres limits a query string and each bind parameter to MaxAllocSize (1 GB - 1); the protocol message length is an int32. A 2.4 KB literal is a non-issue either inlined or bound.
  - source: `measured this session (wc -c on `SELECT vec::text`); PostgreSQL protocol / MaxAllocSize`
- **[high]** Passing the halfvec as a BOUND PARAMETER does not disable the HNSW index. `PREPARE ann(halfvec(200), text[]) AS SELECT ... ORDER BY vec <=> $1 LIMIT 5` then EXPLAIN ANALYZE EXECUTE shows `Index Scan using words_vec_hnsw on words`, 7.3 ms.
  - source: `measured this session`
- **[high]** Exact rank query (seq scan over 180k rows, filter is_output=true on 100,080 of them, cosine distance vs a 200-dim halfvec literal): 35-40 ms cold, 13-22 ms warm single-threaded, 11.7 ms with max_parallel_workers_per_gather=2. Reading 10,016 buffers (~82 MB heap).
  - source: `measured this session, EXPLAIN (ANALYZE, BUFFERS) on PG 17.11 / Apple Silicon`
- **[high]** On pre-normalized vectors, <#> (negative inner product) is only ~10% faster than <=> for the same full scan: 13.5 ms vs 15.0 ms warm. <-> is 14.8 ms. Not worth changing the operator class for.
  - source: `measured this session`
- **[high]** Partial HNSW build on 100,080 rows x halfvec(200) with halfvec_cosine_ops: 30-34 s serial. Index size 71 MB; base table 82 MB.
  - source: `measured this session`
- **[high]** maintenance_work_mem threshold: at 128 MB pgvector emitted `NOTICE: hnsw graph no longer fits into maintenance_work_mem after 58118 tuples / Building will take significantly more time.` At 300 MB there was no notice. Extrapolating linearly, 100,080 tuples need ~225 MB; set at least 256 MB.
  - source: `measured this session`
- **[high]** Neon sets maintenance_work_mem from the MINIMUM compute size: 0.25 CU (1 GB RAM) -> 64 MB, 0.50 CU -> 64 MB, 1 CU -> 67 MB, 2 CU -> 134 MB, 4 CU -> 268 MB. Formula: max(min_compute_RAM_bytes * 1024/63963136, 65536). It CAN be raised per-session with `SET maintenance_work_mem='...'`, and Neon advises not exceeding 60% of available RAM.
  - source: `https://neon.com/docs/reference/compatibility (Parameter settings that differ by compute size)`
- **[high]** Neon Free plan: 0.5 GB storage per project, 100 CU-hours per project per month, autosuspend after 5 min of inactivity (cannot be disabled on Free), autoscaling capped at 2 CU / 8 GB RAM, 100 projects, 10 branches per project, 5 GB public network transfer per project per month, 1 day monitoring history.
  - source: `https://neon.com/docs/introduction/plans`
- **[high]** Neon connection limits: max_connections = max(100, min(4000, floor(compute_size * 419.66))) where compute_size = min(max_compute, 8 * min_compute). For Free autoscaling 0.25->2 CU that is 839 direct connections. The PgBouncer pooler (-pooler hostname) accepts max_client_conn = 10,000 with default_pool_size = 0.9 x max_connections.
  - source: `https://neon.com/docs/connect/connection-pooling + https://neon.com/docs/reference/compatibility`
- **[high]** Neon regions (AWS): us-east-1, us-east-2, us-west-2, eu-central-1, eu-west-2, ap-southeast-1 (Singapore), ap-southeast-2 (Sydney), sa-east-1. Azure regions are deprecated and closed to new projects. ap-northeast-1 (Tokyo) is NOT available.
  - source: `https://neon.com/docs/introduction/regions`
- **[high]** pgvector on Neon: version 0.8.0 on Postgres 14/15/16/17, and 0.8.6 on Postgres 18. Installed with `CREATE EXTENSION vector;`. halfvec (introduced in pgvector 0.7.0) and HNSW on halfvec up to 4,000 dimensions are therefore available on all of them.
  - source: `https://github.com/neondatabase/website/blob/main/content/docs/extensions/pg-extensions.md + https://neon.com/docs/extensions/pgvector`
- **[high]** Bulk load wire size, measured exactly by COPY TO on the 180,000-row table: BINARY format = 78,008,911 bytes (78.0 MB, 433 B/row); TEXT format = 438,051,854 bytes (438 MB, 2,433 B/row). Binary is 5.6x smaller.
  - source: `measured this session: COPY words_bin TO '/tmp/out.bin' WITH (FORMAT BINARY) vs text`
- **[high]** psycopg3 binary COPY of 180,000 rows x halfvec(200) using pgvector.HalfVector + copy.set_types(['int4','text','bool','halfvec']) took 0.45-0.93 s over localhost TCP. Server-side text COPY FROM a local file took 2.46 s.
  - source: `measured this session with psycopg[binary] + pgvector 0.4.x python`
- **[high]** In pgvector-python, HalfVector is imported from the top-level `pgvector` package (`from pgvector import HalfVector`), NOT from `pgvector.psycopg` — importing it from pgvector.psycopg raises ImportError. register_vector still comes from pgvector.psycopg.
  - source: `measured this session (ImportError reproduced)`
- **[high]** drizzle-kit does NOT emit `CREATE EXTENSION vector` in generated migrations — the generated 0000 migration contained only CREATE TABLE + CREATE INDEX. You must add it as a separate custom migration ordered first via `drizzle-kit generate --custom --name=enable_pgvector`.
  - source: `measured this session`
- **[high]** `drizzle-kit migrate` runs each migration inside a transaction, so `CREATE INDEX CONCURRENTLY` in a migration FAILS — and it fails silently: exit code 1 with no error text printed, the spinner just stops at 'applying migrations...'. Removing the CONCURRENTLY statement made the identical run succeed.
  - source: `measured this session with drizzle-kit@0.31.10`
- **[high]** drizzle's `sql` template expands a JS array into a comma-separated PARAMETER LIST, not a single array parameter: sql`... <> all(${['a','b','c']}::text[])` renders `<> all(($2, $3, $4)::text[])` and Postgres errors 42809 'op ANY/ALL (array) requires array on right side'. The fix is `sql.param(exclude)` (renders one $n bound as a Postgres array) or drizzle's notInArray().
  - source: `measured this session with drizzle-orm@0.45.2 + pg@8.23.0`
- **[high]** Neon's own guidance: use TCP drivers (pg / postgres.js) where the process persists and can hold a pool; use @neondatabase/serverless where it cannot. HTTP mode is 'faster for single queries (~3 round trips vs ~8 for TCP)' but supports only non-interactive transactions; WebSocket mode supports interactive transactions but 'WebSocket connections cannot outlive a single request'.
  - source: `https://neon.com/docs/connect/choose-connection`
- **[high]** Vercel's guidance for Fluid Compute is a standard Postgres TCP connection with node-postgres plus a pool registered via attachDatabasePool() from @vercel/functions, which releases idle connections before the function is suspended. pg is explicitly on the supported-client list; postgres-js is not.
  - source: `https://vercel.com/kb/guide/efficiently-manage-database-connection-pools-with-fluid-compute`
- **[high]** HNSW ANN queries are approximate and will give a WRONG rank: a top-K formulation with hnsw.ef_search=200 counted 7 words closer than the threshold where the exact seq scan counted 9. It was 1.5 ms vs 15 ms, but the rank is not reproducible.
  - source: `measured this session`
- **[high]** pgvector guidance for builds: `SET maintenance_work_mem = '8GB'` and `SET max_parallel_maintenance_workers = 7`, build indexes AFTER loading data, and `hnsw.ef_search` defaults to 40.
  - source: `https://github.com/pgvector/pgvector`

## コード片

### package.json — exact versions to pin

```json
{
  "dependencies": {
    "drizzle-orm": "0.45.2",
    "pg": "8.23.0",
    "@vercel/functions": "latest"
  },
  "devDependencies": {
    "drizzle-kit": "0.31.10",
    "@types/pg": "^8.11.0"
  }
}
```

### apps/api/src/db/client.ts — the driver (node-postgres + Neon pooler + Fluid)

```typescript
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import * as schema from './schema';

// DATABASE_URL must be the -pooler host:
//   postgresql://user:pw@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
// Module scope on purpose: Fluid Compute reuses the warm instance across invocations,
// so the TCP + TLS + Postgres auth handshake is paid once, not per request.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
  max: 5,                       // per warm instance; the pooler handles the rest
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// Releases idle connections before Vercel suspends the instance.
attachDatabasePool(pool);

export const db = drizzle(pool, { schema });
```

### packages/db/schema.ts — native halfvec + partial HNSW index (verified to generate correct SQL)

```typescript
import { pgTable, text, boolean, integer, halfvec, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { VECTOR_DIMENSIONS } from '@repo/contracts/constants'; // = 200

export const words = pgTable(
  'words',
  {
    id: integer('id').primaryKey(),
    word: text('word').notNull().unique(),
    isOutput: boolean('is_output').notNull().default(false),
    vec: halfvec('vec', { dimensions: VECTOR_DIMENSIONS }).notNull(),
  },
  (t) => [
    index('words_vec_hnsw')
      .using('hnsw', t.vec.op('halfvec_cosine_ops'))
      .where(sql`${t.isOutput}`),
  ],
);

// drizzle-kit generate emits exactly:
//   "vec" halfvec(200) NOT NULL
//   CREATE INDEX "words_vec_hnsw" ON "words" USING hnsw ("vec" halfvec_cosine_ops)
//     WHERE "words"."is_output";
// The column reads/writes as number[] (mapFromDriverValue parses '[a,b,c]').
```

### customType<> fallback for halfvec — ONLY if you hit a drizzle-kit regression

```typescript
import { customType } from 'drizzle-orm/pg-core';

// Behaves identically to the built-in halfvec(): number[] in, number[] out.
export const halfvecCustom = <D extends number>(dimensions: D) =>
  customType<{ data: number[]; driverData: string; config: { dimensions: D } }>({
    dataType() {
      return `halfvec(${dimensions})`;   // NOT quoted — this is a type, not an identifier
    },
    toDriver(value: number[]): string {
      if (value.length !== dimensions) throw new Error(`expected ${dimensions} dims`);
      return `[${value.join(',')}]`;      // pgvector text input format
    },
    fromDriver(value: string): number[] {
      return value.slice(1, -1).split(',').map(Number); // '[a,b,c]' -> number[]
    },
  })('vec');

// usage:  vec: halfvecCustom(200)().notNull()
// Reading it back as text explicitly (bypasses any codec):  sql`${t.vec}::text`
```

### (a) fetch two words' vectors as text and parse to number[]

```typescript
import { sql, inArray } from 'drizzle-orm';
import { db } from './client';
import { words } from './schema';

const parseVec = (s: string): number[] => s.slice(1, -1).split(',').map(Number);

// Option 1 — raw, explicit ::text cast (works with any codec):
const rows = await db.execute<{ word: string; vec: string }>(sql`
  SELECT ${words.word} AS word, ${words.vec}::text AS vec
  FROM ${words}
  WHERE ${words.word} = ANY (${sql.param([wordA, wordB])}::text[])
`);
const byWord = new Map(rows.rows.map((r) => [r.word, parseVec(r.vec)]));

// Option 2 — typed builder; drizzle's halfvec codec already returns number[]:
const rows2 = await db
  .select({ word: words.word, vec: words.vec })   // vec: number[]
  .from(words)
  .where(inArray(words.word, [wordA, wordB]));

// Raw SQL equivalent:
//   SELECT word, vec::text FROM words WHERE word = ANY ($1::text[]);
```

### (b) nearest neighbour over is_output, excluding a word list, JS-computed vector

```typescript
import { sql } from 'drizzle-orm';

const lit = `[${mixed.join(',')}]`;            // 2,408-2,420 bytes for 200 dims
const exclude = ['ねこ', 'いぬ', 'とり'];

// NOTE the two gotchas, both verified:
//  1. sql.param(exclude) — a bare ${exclude} expands to ($2,$3,$4) and Postgres
//     errors 42809 "op ANY/ALL (array) requires array on right side".
//  2. ::halfvec(200) cast is required; lit binds as text.
const nn = await db.execute<{ word: string; dist: number }>(sql`
  SELECT ${words.word} AS word,
         (${words.vec} <=> ${lit}::halfvec(200))::float8 AS dist
  FROM ${words}
  WHERE ${words.isOutput}
    AND ${words.word} <> ALL (${sql.param(exclude)}::text[])
  ORDER BY ${words.vec} <=> ${lit}::halfvec(200)
  LIMIT 1
`);

// Typed-builder form (measured 3 ms warm, uses the partial HNSW index):
import { and, eq, asc, notInArray } from 'drizzle-orm';
const dist = sql<number>`${words.vec} <=> ${lit}::halfvec(200)`;
const nn2 = await db
  .select({ word: words.word, dist })
  .from(words)
  .where(and(eq(words.isOutput, true), notInArray(words.word, exclude)))
  .orderBy(asc(dist))
  .limit(1);

// Raw SQL:
//   SET LOCAL hnsw.ef_search = 100;
//   SELECT word, (vec <=> $1::halfvec(200))::float8 AS dist
//   FROM words
//   WHERE is_output AND word <> ALL ($2::text[])
//   ORDER BY vec <=> $1::halfvec(200)
//   LIMIT 1;
```

### (c) rank — count of output words strictly closer to goal than the result

```typescript
// EXACT rank. Must be a full scan: HNSW is approximate and gave 7 instead of 9
// in this session's test, so the score would not be reproducible.
const goalLit  = `[${goalVec.join(',')}]`;

const rank = await db.execute<{ n: number }>(sql`
  SELECT count(*)::int AS n
  FROM ${words}
  WHERE ${words.isOutput}
    AND (${words.vec} <=> ${goalLit}::halfvec(200))
        < (SELECT w.vec <=> ${goalLit}::halfvec(200)
           FROM ${words} w WHERE w.word = ${resultWord})
`);
// rank.rows[0].n is the number of output words strictly closer; +1 = the 1-based rank.

// Raw SQL (the goal literal bound ONCE via a CTE, so only ~2.4 KB on the wire):
//   WITH g AS (SELECT $1::halfvec(200) AS v),
//        r AS (SELECT w.vec <=> (SELECT v FROM g) AS d
//              FROM words w WHERE w.word = $2)
//   SELECT count(*)::int AS n
//   FROM words, g, r
//   WHERE words.is_output AND (words.vec <=> g.v) < r.d;
```

### Collapse 4-5 round trips into ONE statement (do this — it beats any driver choice)

```sql
-- $1 = goal word, $2 = word A, $3 = word B, $4 = mixed vector literal,
-- $5 = words already used (text[]).
WITH goal AS (
  SELECT vec AS v FROM words WHERE word = $1
),
mix AS (
  SELECT $4::halfvec(200) AS v
),
result AS (
  SELECT w.id, w.word, (w.vec <=> (SELECT v FROM goal)) AS goal_dist
  FROM words w, mix
  WHERE w.is_output
    AND w.word <> ALL ($5::text[])
    AND w.word NOT IN ($1, $2, $3)
  ORDER BY w.vec <=> mix.v
  LIMIT 1
),
rank AS (
  SELECT count(*)::int AS closer
  FROM words w, goal, result
  WHERE w.is_output AND (w.vec <=> goal.v) < result.goal_dist
)
SELECT result.word,
       result.goal_dist,
       (1.0 - result.goal_dist)::float8 AS similarity,
       rank.closer + 1                  AS rank
FROM result, rank;
```

### Migration 0000 — raw SQL for CREATE EXTENSION (drizzle-kit never emits it)

```bash
# 1. Empty custom migration, ordered FIRST so the halfvec type exists before CREATE TABLE
pnpm drizzle-kit generate --custom --name=enable_pgvector
# -> drizzle/0000_enable_pgvector.sql ; put this single line in it:
#      CREATE EXTENSION IF NOT EXISTS vector;

# 2. Normal schema migration
pnpm drizzle-kit generate --name=init
# -> drizzle/0001_init.sql  (CREATE TABLE words ... halfvec(200) + the partial HNSW index)

# Verified end to end against a real pgvector server: `drizzle-kit migrate` applied
# 0000 then 0001 and produced:
#   "words_vec_hnsw" hnsw (vec halfvec_cosine_ops) WHERE is_output
```

### drizzle.config.ts + CI migration step

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/db/schema.ts',
  out: './packages/db/drizzle',
  dbCredentials: { url: process.env.DATABASE_URL_DIRECT! }, // DIRECT host, not -pooler
  migrations: { table: '__drizzle_migrations', schema: 'drizzle' },
  strict: true,
  verbose: true,
});
```

### GitHub Actions — run migrations against Neon

```yaml
- name: Migrate Neon
  env:
    # Direct (non-pooler) endpoint: DDL + advisory locks want a real session.
    DATABASE_URL_DIRECT: ${{ secrets.NEON_DATABASE_URL_DIRECT }}
  run: pnpm drizzle-kit migrate

# Use `migrate`, never `push`, against anything shared.
#  - migrate: applies the committed .sql files in order, records them in
#    drizzle.__drizzle_migrations, is reviewable and reproducible, and is the only
#    way to ship raw SQL (CREATE EXTENSION, HNSW index, ANALYZE).
#  - push: diffs your TS schema straight against the live DB with no migration
#    file. It will not create the extension and it happily proposes to DROP the
#    HNSW index whenever its opclass round-trips differently. Dev scratch only.
#
# GOTCHA (measured): drizzle-kit migrate runs each file in a TRANSACTION, so
# `CREATE INDEX CONCURRENTLY` fails — and it fails SILENTLY (exit 1, spinner
# stops at "applying migrations...", no error text). Keep CONCURRENTLY out of
# migrations; run it as a one-off ops script if you ever need it.
```

### The HNSW index, with the memory tuning Neon Free needs

```sql
-- Run AFTER the bulk load (pgvector builds far faster on a populated table).
-- Neon Free defaults maintenance_work_mem to 64 MB (0.25 CU). Measured: at
-- 128 MB pgvector printed "hnsw graph no longer fits into maintenance_work_mem
-- after 58118 tuples"; 300 MB was enough for 100,080 rows. Budget ~225 MB.
SET maintenance_work_mem = '256MB';
SET max_parallel_maintenance_workers = 2;

CREATE INDEX words_vec_hnsw
  ON words USING hnsw (vec halfvec_cosine_ops)
  WHERE is_output;

ANALYZE words;

-- Measured: 30-34 s serial for 100,080 x halfvec(200); index = 71 MB, table = 82 MB.
-- Query-time recall knob (default 40):
--   SET LOCAL hnsw.ef_search = 100;
-- pgvector 0.8+ for heavily filtered ANN:
--   SET LOCAL hnsw.iterative_scan = relaxed_order;
```

### tools/pipeline — fastest bulk load: psycopg3 binary COPY

```python
import numpy as np, psycopg
from pgvector.psycopg import register_vector
from pgvector import HalfVector          # <- top level, NOT pgvector.psycopg

DSN = os.environ["DATABASE_URL_DIRECT"]  # direct endpoint, sslmode=require
DIMS = 200

with psycopg.connect(DSN, autocommit=True) as conn:
    conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
    register_vector(conn)

    vecs = vecs.astype(np.float32)
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)   # normalize at build time

    cur = conn.cursor()
    with cur.copy(
        "COPY words (id, word, is_output, vec) FROM STDIN WITH (FORMAT BINARY)"
    ) as copy:
        copy.set_types(["int4", "text", "bool", "halfvec"])   # REQUIRED for binary
        for i, (w, is_out) in enumerate(meta):
            copy.write_row([i, w, is_out, HalfVector(vecs[i])])

    conn.execute("SET maintenance_work_mem = '256MB'")
    conn.execute("SET max_parallel_maintenance_workers = 2")
    conn.execute("CREATE INDEX words_vec_hnsw ON words "
                 "USING hnsw (vec halfvec_cosine_ops) WHERE is_output")
    conn.execute("ANALYZE words")

# Measured for 180,000 rows x halfvec(200):
#   binary COPY wire payload = 78.0 MB (433 B/row); 0.45-0.93 s over localhost
#   text   COPY wire payload = 438  MB (2,433 B/row)  <- 5.6x more
# Over the internet to Neon Singapore the wall clock is bandwidth-bound:
#   78 MB at 20 Mbps up  ~ 35 s | at 50 Mbps ~ 14 s | at 100 Mbps ~ 7 s
#   plus ~30-90 s for the HNSW build on a 0.25-2 CU Free compute.
```


## リスク

- NEON HAS NO TOKYO REGION. The closest is aws-ap-southeast-1 (Singapore), ~70-90 ms RTT from Japan. If the Vercel function is not co-located, 4-5 sequential round trips cost 300-450 ms of pure network. Pin the Vercel function region to sin1 (matching Neon), and collapse the per-move work into ONE SQL statement — that single change is worth more than any driver comparison. Player -> Vercel edge latency stays fine because Vercel routes the request; only the function-to-DB hop must be co-located.
- NEON FREE STORAGE IS 0.5 GB AND YOU WILL USE ~153 MB OF IT (82 MB table + 71 MB HNSW index) BEFORE HISTORY. Every re-run of the pipeline writes another ~80 MB of WAL that Neon retains as branch history. Re-loading 3-4 times can exhaust the quota; when it does, the compute suspends until the next billing period. Reload into a fresh branch or TRUNCATE + VACUUM FULL rather than DROP/CREATE repeatedly, and drop the index before reloading.
- THE RANK QUERY WILL NOT RELIABLY BE <100 ms ON NEON FREE. Measured 13-22 ms warm on a full local core; Neon Free idles at 0.25 vCPU and only autoscales up under sustained load, so budget 60-250 ms warm and 1-4 s on the first request after the 5-minute autosuspend (compute cold start plus pulling 82 MB of pages from the pageserver into the local file cache). Autosuspend cannot be disabled on Free. Either accept a slow first move, add a cron ping, or upgrade to Launch where autosuspend is configurable.
- DO NOT USE HNSW FOR THE RANK. It is approximate: with hnsw.ef_search=200 it counted 7 words closer to the goal where the exact scan counted 9. A player's score would change between identical games. The rank must be the full sequential scan; the HNSW index is only for the nearest-neighbour lookup in (b).
- `sql`...<> ALL(${jsArray})`` SILENTLY COMPILES TO A PARAMETER LIST, NOT AN ARRAY. drizzle renders `($2, $3, $4)` and Postgres throws 42809 'op ANY/ALL (array) requires array on right side'. Always `sql.param(exclude)` + an explicit `::text[]`, or use drizzle's notInArray(). Reproduced this session.
- `CREATE INDEX CONCURRENTLY` IN A DRIZZLE MIGRATION FAILS SILENTLY. drizzle-kit migrate wraps each file in a transaction; the run exits 1 with the spinner frozen at 'applying migrations...' and prints no error at all. Easy to mistake for a hang or a network problem in CI. Keep CONCURRENTLY out of migrations entirely.
- drizzle-kit DOES NOT EMIT `CREATE EXTENSION vector`. Without a hand-written custom migration ordered before the table migration, a fresh database fails on `halfvec(200)` with 'type halfvec does not exist'. This bites on every new Neon branch and every CI preview database.
- NEON FREE'S DEFAULT maintenance_work_mem IS 64 MB — a quarter of what the index needs. Without `SET maintenance_work_mem='256MB'` pgvector falls back to its on-disk two-pass build path (it warns at 128 MB after 58,118 of 100,080 tuples). On a throttled 0.25 CU compute that path can turn a ~30 s build into many minutes. Also note Neon derives the default from your MINIMUM compute size, so raising the max alone changes nothing.
- DO NOT USE postgres-js WITH THE NEON POOLER WITHOUT `prepare: false`. postgres-js issues named prepared statements by default; PgBouncer in transaction mode multiplexes sessions and the statement will not exist on the connection you land on. Symptom is intermittent 'prepared statement "s1" does not exist' under concurrency only — it passes local testing against a direct connection.
- DO NOT BUILD RULE JUDGING ON @neondatabase/serverless HTTP MODE. It supports only non-interactive transaction(); you cannot read, decide in JS, and write inside one transaction. The WebSocket variant can, but a WebSocket 'cannot outlive a single request' in serverless, so you pay full connection setup every invocation.
- A TEXT COPY OF THE 180k-ROW LOAD IS 438 MB — and Neon Free allows only 5 GB of public network transfer per project per month. Ten text reloads would exhaust the egress allowance. Binary COPY (78 MB) makes this a non-issue.
- pgvector on Neon is 0.8.0 for Postgres 14-17 and 0.8.6 only on Postgres 18. Both have halfvec and HNSW-on-halfvec, but if you want hnsw.iterative_scan's newest fixes, create the project on Postgres 18. The version is fixed at project creation.

## 結論

Pin `drizzle-orm@0.45.2` + `drizzle-kit@0.31.10` (ignore the 1.0.0-rc line). Use the **native `halfvec({dimensions: 200})`** from `drizzle-orm/pg-core` — I verified both the runtime codec (number[] in/out) and that drizzle-kit 0.31.10 generates `halfvec(200)` unquoted plus a correct partial HNSW index; the `customType<>` fallback above is insurance you should not need.

Driver: **`pg` 8.23 via `drizzle-orm/node-postgres`**, module-scope `Pool` on the Neon `-pooler` host, `attachDatabasePool(pool)` from `@vercel/functions`, Fluid Compute enabled. Not postgres-js (named prepared statements break under PgBouncer transaction pooling, and it is not an `attachDatabasePool` client). Not `@neondatabase/serverless` (HTTP pays one HTTPS request per query — exactly wrong for 4-5 of them — and cannot do the interactive transaction that server-side rule judging needs). Run migrations through the **direct** endpoint, application traffic through the **pooler**.

Create the Neon project in **`aws-ap-southeast-1` (Singapore)** — Tokyo does not exist on Neon — and pin the Vercel function region to `sin1` to match. Then **collapse the whole move into one SQL statement** (the CTE snippet above). This is the single highest-leverage decision in the whole design: at 4-5 round trips you are paying 4-5× the function-to-DB RTT, and it is the difference between a ~150 ms move and a ~500 ms move if anything is ever mis-colocated.

Schema and indexing: normalize vectors to unit length in the Python pipeline so `1 - (vec <=> goal)` is a clean similarity; keep `<=>` and `halfvec_cosine_ops` (`<#>` measured only ~10% faster — not worth the sign-flip bugs). Build the HNSW index **partial on `WHERE is_output`**, after the load, with `SET maintenance_work_mem='256MB'` — Neon Free's 64 MB default drops pgvector onto its slow on-disk build path. Measured: 30-34 s build, 71 MB index, 82 MB table.

Queries: pass the JS-computed vector as a **bound parameter** cast `::halfvec(200)` — 2.4 KB against a 1 GB limit, and I confirmed the HNSW index is still used through `PREPARE`. Use HNSW for the nearest-neighbour lookup (1.5-7 ms measured), but compute the **rank with an exact sequential scan** — HNSW's approximation returned 7 instead of 9 in testing and would make scores non-reproducible. Always wrap exclusion lists in `sql.param(list)::text[]`.

Migrations: **`drizzle-kit migrate`, never `push`**. Migration 0000 is a `--custom` file containing only `CREATE EXTENSION IF NOT EXISTS vector;`; 0001 is the generated schema. Never put `CREATE INDEX CONCURRENTLY` in a migration — it fails with exit 1 and *no error output*.

Bulk load: **psycopg3 binary COPY** with `copy.set_types([..., 'halfvec'])` and `pgvector.HalfVector` (imported from `pgvector`, not `pgvector.psycopg`). 78 MB on the wire versus 438 MB for text, sub-second server-side; over the internet to Singapore expect roughly 10-35 s depending on your uplink, plus ~30-90 s for the index build.

One honest caveat on Neon Free: with 0.5 GB storage against ~153 MB of table+index, 5-minute non-disableable autosuspend, and 0.25 CU baseline, expect a 1-4 s first move after idle and 60-250 ms warm for the rank query — `<100 ms` is not a promise you can make on Free. It is fine for development and a soft launch; plan on Launch tier (configurable autosuspend, larger `maintenance_work_mem` default) before anyone plays this seriously.
