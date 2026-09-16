# Better Auth 1.7.5 (better-auth + @better-auth/expo) for Hono-on-Vercel + Expo Go anonymous auth

## 要約

**Versions (verified via npm, 2026-09-17):** `better-auth@1.7.5`, `@better-auth/expo@1.7.5`, `@better-auth/drizzle-adapter@1.7.5`. Two package-name traps: (1) the CLI is now the `auth` package — `npx auth@latest generate`; `@better-auth/cli` is stale at **1.4.21** and will silently generate a 3-minor-old schema. (2) The Drizzle adapter moved to its own package, but `better-auth/adapters/drizzle` is still a valid re-export (confirmed in the `exports` map), so no import change is needed.

**I did not trust the docs on the origin question — I ran it.** I stood up a real Hono server with `anonymous() + expo() + bearer()` under `NODE_ENV=production` (i.e. Vercel) and drove it with the exact header the Expo client sends. Results:

- The `expo-origin` → `Origin` translation **works** in 1.7.5 on Hono. Issues #7014/#9490 are fixed (the plugin now has a `catch` that clones the Request when headers are immutable).
- **Origin validation only fires when the request carries a `Cookie` header** (`validateOrigin`: `if (!(forceValidate || useCookies)) return`). So with `trustedOrigins: []` the *first* anonymous sign-in returns **200** — even with `Origin: https://evil.com`. The second POST, once a cookie exists, returns **403 INVALID_ORIGIN**. This is the trap: it looks configured correctly on a fresh install and breaks on relaunch.
- GET requests never origin-check, so `get-session` always works. Only POSTs (`sign-in/*`, `sign-out`, `update-user`) fail.
- **There IS a working wildcard.** Verified matrix against `exp://192.168.1.23:8081/--/`: `exp://` ✅, `exp://**` ✅, `exp://192.168.*.*:*/**` ✅, **`exp://*` ❌ (403)**. `exp://*` is the natural thing to write and it does not work, because the wildcard matcher splits on `/` and `*` is `[^/\\]*?`.
- `"exp://"` (no wildcard) takes the *custom-scheme* branch: empty authority in the pattern ⇒ **any** `exp://` host matches, including `exp://evil.com/--/` (verified 200). So it works, but it is not CSRF protection — which is fine, because a native app has no ambient credentials to forge.
- The expo server plugin auto-injects `trustedOrigins: ["exp://"]` **only when `NODE_ENV === "development"`** (read from dist source). Vercel functions always run `NODE_ENV=production`, so **you must add the exp:// patterns yourself, gated on your own env var, not NODE_ENV.**

**Native modules:** peer deps are `expo-secure-store`, `expo-network`, `expo-linking`, `expo-constants`, `expo-web-browser`. All five are in Expo Go's bundled module set on SDK 54/55/56 — **no non-Expo-Go native module is required.** `expo-web-browser` is only dynamically `import()`ed on OAuth redirect flows, so an anonymous-only app never loads it.

**The real risk is not auth, it's the SDK floor.** Better Auth's Expo docs state SDK 55+ / RN 0.83 / New Architecture. Expo Go on the **Apple App Store is still SDK 54** (SDK 55 and 56 require `eas go` + your own TestFlight). I checked `bundledNativeModules.json` for `expo@54.0.37`: every `@better-auth/expo` peer range is satisfied (secure-store 15.0.8, network 8.0.8, web-browser 15.0.11, linking 8.0.12, constants 18.0.14), so SDK 54 will very likely work — but it is outside stated support.


## 事実

- **[high]** Latest stable: better-auth@1.7.5 and @better-auth/expo@1.7.5 (both published, same version line).
  - source: `npm view better-auth version; npm view @better-auth/expo version (run 2026-09-17)`
- **[high]** The CLI is now the `auth` npm package at 1.7.5. `@better-auth/cli` is abandoned at 1.4.21 — `npx @better-auth/cli generate` produces a 3-minor-version-old schema with no warning.
  - source: `npm view @better-auth/cli version -> 1.4.21; npm view auth version -> 1.7.5; https://www.better-auth.com/docs/concepts/cli`
- **[high]** `@better-auth/drizzle-adapter@1.7.5` is a separate package, but is a dependency of better-auth and `better-auth/adapters/drizzle` remains in the exports map — existing import path still works.
  - source: `npm view better-auth@1.7.5 dependencies; better-auth-1.7.5/package/package.json exports`
- **[high]** `npx auth@1.7.5 generate --config src/auth.ts --output ./schema.ts -y` does generate the full Drizzle pg schema (user, session, account, verification + plugin tables + relations). I ran it successfully.
  - source: `/private/tmp/claude-501/-Users-tmba-Repositories-github-com-nu-chotech-coto2ba-next/11ab5ca5-a798-4139-ae34-4203ce720867/scratchpad/gen/schema3.ts`
- **[high]** `user.additionalFields` without a `fieldName` auto-snake_cases the DB column while keeping the camelCase TS key (displayName -> text("display_name")). Passing `fieldName: "display_name"` makes the CLI emit an ugly snake_case TS property key too — omit it.
  - source: `Compared generated schema.ts (with fieldName) vs schema2.ts (without) in scratchpad/gen`
- **[high]** The anonymous plugin adds exactly one column: `isAnonymous: boolean("is_anonymous").default(false)` on user. The expo plugin adds no tables.
  - source: `Generated schema2.ts with plugins: [anonymous(), expo()]`
- **[high]** Origin validation is SKIPPED entirely when the request has no Cookie header. With trustedOrigins: [] a first anonymous sign-in returns 200 even with Origin: https://evil.com; the same POST with a cookie returns 403 INVALID_ORIGIN.
  - source: `Empirical: scratchpad/gen/e2e2.mjs; source at better-auth/dist/api/middlewares/origin-check.mjs (`if (!(forceValidate || useCookies)) return`)`
- **[high]** Verified trustedOrigins matrix against the real Expo Go origin `exp://192.168.1.23:8081/--/` with a cookie present: `exp://` -> 200, `exp://**` -> 200, `exp://192.168.*.*:*/**` -> 200, `exp://*` -> 403, `[]` -> 403.
  - source: `/private/tmp/claude-501/-Users-tmba-Repositories-github-com-nu-chotech-coto2ba-next/11ab5ca5-a798-4139-ae34-4203ce720867/scratchpad/gen/e2e2.mjs`
- **[high]** `trustedOrigins: ["exp://"]` matches ANY exp:// host — `exp://evil.com/--/` returns 200. The non-wildcard custom-scheme branch returns true whenever the pattern's authority is empty and the scheme matches.
  - source: `Empirical e2e2.mjs; better-auth/dist/auth/trusted-origins.mjs matchesOriginPattern`
- **[high]** The expo server plugin only auto-adds `trustedOrigins: ["exp://"]` when `process.env.NODE_ENV === "development"`. Vercel functions run NODE_ENV=production, so this never applies in deployment.
  - source: `@better-auth/expo@1.7.5 dist/index.js: `init: (ctx) => ({ options: { trustedOrigins: process.env.NODE_ENV === "development" ? ["exp://"] : [] } })``
- **[high]** GET requests never run the origin check (originCheckMiddleware returns early on GET/OPTIONS/HEAD), so `/get-session` always works. Only POSTs fail.
  - source: `better-auth/dist/api/middlewares/origin-check.mjs`
- **[high]** The expo client sets `options.credentials = "omit"`, attaches the stored cookie manually as a `cookie` header, and sends `expo-origin: Linking.createURL("", { scheme })`. The server plugin's onRequest copies expo-origin into the origin header.
  - source: `@better-auth/expo@1.7.5 dist/client.js (fetchPlugins[0].init) and dist/index.js (onRequest)`
- **[high]** Cookie persistence: the client stores a JSON map {cookieName: {value, expires}} in SecureStore under key `${storagePrefix}_cookie`, and the session cache under `${storagePrefix}_session_data`. Colons in keys are replaced with underscores, and values over 1800 UTF-8 bytes are split across up to 100 chunk keys.
  - source: `@better-auth/expo@1.7.5 dist/client.js (normalizeCookieName, STORAGE_VALUE_LIMIT=1800, MAX_STORAGE_CHUNKS=100)`
- **[high]** @better-auth/expo peer deps: expo-secure-store>=12.5.0, expo-network>=8.0.7, expo-linking>=7.0.0, expo-constants>=17.0.0, expo-web-browser>=14.0.0. All five ship in Expo Go on SDK 54, 55 and 56 — no custom dev client needed.
  - source: `npm view @better-auth/expo@1.7.5 peerDependencies; expo@54.0.37 / 55.0.31 / 56.0.21 bundledNativeModules.json`
- **[medium]** Better Auth's Expo docs state SDK 55+ (RN 0.83, React 19.2) with New Architecture required, but expo@54.0.37 satisfies every peer range (secure-store 15.0.8, network 8.0.8, web-browser 15.0.11, linking 8.0.12, constants 18.0.14).
  - source: `https://www.better-auth.com/docs/integrations/expo + expo@54.0.37 bundledNativeModules.json`
- **[high]** Expo Go on the Apple App Store is still SDK 54 as of Sept 2026. SDK 55 and 56 Expo Go for iOS require `eas go` (your own TestFlight build) or the simulator; Android can install from Expo CLI.
  - source: `https://expo.dev/changelog/expo-go-and-app-store-may-2026`
- **[high]** Expo docs explicitly warn that Linking.createURL in Expo Go is 'neither stable nor predictable during the lifetime of the app' and recommend a dev/standalone build for anything relying on a stable URL.
  - source: `https://docs.expo.dev/versions/latest/sdk/linking/`
- **[high]** The bearer() plugin completely bypasses the origin problem: POST /update-user with `Authorization: Bearer <token>` and NO cookie returned 200 with trustedOrigins: []; the identical POST with a cookie returned 403.
  - source: `/private/tmp/claude-501/-Users-tmba-Repositories-github-com-nu-chotech-coto2ba-next/11ab5ca5-a798-4139-ae34-4203ce720867/scratchpad/gen/e2e3.mjs`
- **[high]** signIn.anonymous() returns `{ token, user }` where token is the raw (unsigned) session token, and also sets a `set-auth-token` response header. It creates a real user row with a generated unique email and isAnonymous=true.
  - source: `e2e3.mjs output; better-auth/dist/plugins/anonymous/index.d.mts`
- **[high]** Calling signIn.anonymous() while already in an anonymous session throws BAD_REQUEST ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY. The client must check getSession first.
  - source: `better-auth/dist/plugins/anonymous/index.mjs:81 and :187`
- **[high]** Rate limiting is ON by default in production with in-memory storage, which is per-instance and useless on Vercel serverless. `rateLimit: { storage: "database" }` generates an extra `rate_limit` table (id, key unique, count integer, last_request bigint).
  - source: `Hit a spurious 429 during my first e2e run; generated scratchpad/gen/schema3.ts contains pgTable("rate_limit", ...)`
- **[high]** Issue #9490 ([Expo] expo-origin -> Origin translation doesn't reach origin-check middleware) is CLOSED, and my 1.7.5 test confirms the translation now works on Hono.
  - source: `https://github.com/better-auth/better-auth/issues/9490`
- **[medium]** Known Expo-specific bug history, all fixed by 1.7.5 but indicative of churn: #5426 (SecureStore rejects colons in keys), #9151 (oversized cookie jar silently failed to persist -> useSession null), #11082 (chunk marker corruption), #6810 (invalid SecureStore cookie breaks useSession), PR #10438 (iOS crash from synchronous keychain access while device locked).
  - source: `https://github.com/better-auth/better-auth/issues/5426, /issues/9151, /issues/11082, /issues/6810, /pull/10438`

## コード片

### apps/api/src/auth.ts — full working server setup (anonymous + expo + bearer, Drizzle pg)

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins/anonymous";
import { bearer } from "better-auth/plugins/bearer";
import { expo } from "@better-auth/expo";

import { db } from "./db/client";
import * as authSchema from "./db/auth-schema";
import { SESSION_MAX_AGE_SEC, APP_SCHEME } from "@coto2ba/contracts/constants";

// NOTE: do NOT branch on NODE_ENV here. Vercel functions always run
// NODE_ENV=production, so the expo() plugin's built-in dev-only
// `trustedOrigins: ["exp://"]` injection never fires in deployment.
const allowExpoGoOrigins = process.env.ALLOW_EXPO_GO_ORIGINS === "1";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL!,   // e.g. https://coto2ba-api.vercel.app
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET!, // 32+ random bytes

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,   // pass the module so the adapter finds user/session/account/verification
  }),

  trustedOrigins: [
    `${APP_SCHEME}://`,            // standalone / dev-client build, e.g. "coto2ba://"
    `exp+${APP_SCHEME}://**`,      // expo-dev-client
    // Expo Go. `exp://*` does NOT match exp://192.168.x.x:8081/--/ — use `exp://**`.
    // This trusts every exp:// origin; acceptable because a native client has no
    // ambient credentials, so origin checking buys nothing here anyway.
    ...(allowExpoGoOrigins ? ["exp://**"] : []),
  ],

  emailAndPassword: { enabled: false },
  socialProviders: {},

  user: {
    additionalFields: {
      // input: true  -> client may set it via authClient.updateUser()
      displayName:   { type: "string", required: false, input: true },
      // input: false -> server-only. Game rules stay authoritative (CLAUDE.md constraint).
      bestFreeMoves: { type: "number", required: false, input: false },
      booth:         { type: "string", required: false, input: false },
    },
  },

  session: {
    expiresIn: SESSION_MAX_AGE_SEC,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },

  // in-memory rate limiting is per-instance and meaningless on Vercel serverless
  rateLimit: { enabled: true, storage: "database" },

  plugins: [
    anonymous({ emailDomainName: "anon.coto2ba.invalid" }),
    bearer(),   // insurance: lets the client fall back to Authorization and skip origin checks
    expo(),     // must be present: translates the expo-origin header into Origin
  ],
});

export type Session = typeof auth.$Infer.Session;
```

### apps/api/src/db/auth-schema.ts — EXACT output of `npx auth@1.7.5 generate` (Drizzle / pg)

```ts
// Generated by: npx auth@latest generate --config src/auth.ts --output src/db/auth-schema.ts -y
// Verified against better-auth 1.7.5 on 2026-09-17. Do not hand-edit; regenerate.
import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, integer, bigint, index } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  // from anonymous()
  isAnonymous: boolean("is_anonymous").default(false),
  // from user.additionalFields — camelCase key, snake_case column, automatic
  displayName: text("display_name"),
  bestFreeMoves: integer("best_free_moves"),
  booth: text("booth"),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()).notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

// only present when rateLimit.storage === "database"
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));
export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));
export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));
```

### apps/api/src/app.ts + api/index.ts — mounting on Hono, and Hono on Vercel

```ts
// ---------- apps/api/src/app.ts ----------
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { auth, type Session } from "./auth";

export type Env = { Variables: { session: Session | null } };

const app = new Hono<Env>();

// Mount BEFORE any catch-all route. app.all forwards the raw Request untouched —
// this is required, because the expo() plugin rewrites the Origin header on it.
app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

// No CORS middleware needed: React Native does not enforce CORS and sends no
// preflight. Add hono/cors ONLY if a browser client appears, and never reflect
// arbitrary origins.

export const sessionMiddleware = createMiddleware<Env>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set("session", session);
  await next();
});

export const requireSession = createMiddleware<Env>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  c.set("session", session);
  await next();
});

// Game routes. Server is authoritative — never trust client-supplied values.
app.post("/api/game/guess", requireSession, async (c) => {
  const { user } = c.get("session")!;
  // ... judge in apps/api/src/services/game.ts, write user.bestFreeMoves server-side
  return c.json({ ok: true, userId: user.id });
});

export default app;


// ---------- apps/api/api/index.ts (Vercel entrypoint) ----------
import { handle } from "hono/vercel";
import app from "../src/app";

export const config = { runtime: "nodejs" };
export default handle(app);


// ---------- apps/api/vercel.json ----------
// { "rewrites": [{ "source": "/(.*)", "destination": "/api/index" }] }
```

### apps/mobile/lib/auth-client.ts + app.json — Expo client

```ts
// ---------- apps/mobile/app.json ----------
// { "expo": { "scheme": "coto2ba", "newArchEnabled": true } }
// `scheme` is REQUIRED — expoClient throws "Scheme not found in app.json" without it,
// even though Expo Go ignores it and uses exp:// anyway.

// ---------- apps/mobile/lib/auth-client.ts ----------
import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import { anonymousClient } from "better-auth/client/plugins";
import * as SecureStore from "expo-secure-store";
import { APP_SCHEME } from "@coto2ba/contracts/constants";

export const authClient = createAuthClient({
  baseURL: process.env.EXPO_PUBLIC_API_URL!,   // https://coto2ba-api.vercel.app
  plugins: [
    expoClient({
      scheme: APP_SCHEME,        // "coto2ba"
      storagePrefix: "coto2ba",  // -> SecureStore keys coto2ba_cookie / coto2ba_session_data
      storage: SecureStore,
    }),
    anonymousClient(),
  ],
});

/**
 * Persistence, precisely:
 *   - init() sets credentials:"omit" and manually injects a `cookie` header from
 *     SecureStore key `coto2ba_cookie` — a JSON map {name: {value, expires}}.
 *   - It also sends `expo-origin: Linking.createURL("", { scheme })`, which in
 *     Expo Go is `exp://192.168.x.x:8081/--/` and changes with your LAN IP.
 *   - onSuccess() parses Set-Cookie back into that map; /get-session responses
 *     are cached to `coto2ba_session_data` so useSession() hydrates with no spinner.
 *   - Values over 1800 UTF-8 bytes are chunked across keys (SecureStore limit).
 */

// Bootstrap: signIn.anonymous() throws BAD_REQUEST if already anonymous.
export async function ensureSession() {
  const { data } = await authClient.getSession();
  if (data?.user) return data.user;
  const { data: signed, error } = await authClient.signIn.anonymous();
  if (error) throw new Error(error.message);
  return signed!.user;   // { id, name: "Anonymous", email: "<rand>@anon.coto2ba.invalid", isAnonymous: true }
}

// display_name is input:true, so the client may set it. best_free_moves / booth are
// input:false and are rejected here — they can only be written server-side.
export const setDisplayName = (displayName: string) =>
  authClient.updateUser({ displayName });

// For your own (non-/api/auth) Hono routes, forward the stored cookie yourself:
export async function apiFetch(path: string, init: RequestInit = {}) {
  const cookie = await authClient.getCookie();
  return fetch(`${process.env.EXPO_PUBLIC_API_URL}${path}`, {
    ...init,
    credentials: "omit",
    headers: { ...init.headers, cookie, "content-type": "application/json" },
  });
}
```

### Reproduce the trustedOrigins matrix yourself (this is the load-bearing test)

```js
// Run against a real server. Verified output on better-auth 1.7.5, NODE_ENV=production:
//
//   NO COOKIE (first-ever sign-in) -- origin check is SKIPPED, everything returns 200:
//     to=[]                        origin=https://evil.com          -> 200   <-- !!
//     to=[]                        expo-origin=exp://192.168...     -> 200
//
//   WITH COOKIE (every subsequent POST) -- origin check is ENFORCED:
//     to=[]                        expo-origin=exp://192.168...     -> 403 INVALID_ORIGIN
//     to=["exp://*"]               expo-origin=exp://192.168...     -> 403 INVALID_ORIGIN
//     to=["exp://"]                expo-origin=exp://192.168...     -> 200
//     to=["exp://**"]              expo-origin=exp://192.168...     -> 200
//     to=["exp://192.168.*.*:*/**"] expo-origin=exp://192.168...    -> 200
//     to=["exp://"]                expo-origin=exp://evil.com/--/   -> 200   <-- scheme-wide
//
//   BEARER instead of cookie, to=[] :
//     POST /update-user  Authorization: Bearer <token>, no cookie   -> 200
//
// Full harness (run with: node e2e2.mjs) lives at:
//   scratchpad/gen/e2e2.mjs  and  scratchpad/gen/e2e3.mjs
const EXPO_GO_ORIGIN = "exp://192.168.1.23:8081/--/";  // Linking.createURL("") in Expo Go
await fetch(`${BASE}/api/auth/sign-in/anonymous`, {
  method: "POST",
  headers: { "content-type": "application/json", "expo-origin": EXPO_GO_ORIGIN },
  body: "{}",
});
```

### FALLBACK: POST /devices opaque bearer token (~60 lines, zero cookie/origin surface)

```ts
// packages/contracts/src/constants.ts
export const DEVICE_TOKEN_BYTES = 32;
export const DEVICE_TOKEN_HEADER = "authorization";
export const DEVICE_TOKEN_STORAGE_KEY = "coto2ba_device_token";

// ---------- schema ----------
export const devices = pgTable("devices", {
  id: text("id").primaryKey(),                       // this IS the user id
  tokenHash: text("token_hash").notNull().unique(),   // sha256 of the raw token; raw never stored
  displayName: text("display_name"),
  bestFreeMoves: integer("best_free_moves"),
  booth: text("booth"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
});

// ---------- server ----------
const sha256hex = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

app.post("/devices", async (c) => {
  const raw = b64url(crypto.getRandomValues(new Uint8Array(DEVICE_TOKEN_BYTES)));
  const [row] = await db.insert(devices).values({
    id: crypto.randomUUID(),
    tokenHash: await sha256hex(raw),
  }).returning();
  return c.json({ userId: row.id, token: raw }, 201);  // token returned exactly once
});

export const requireDevice = createMiddleware<Env>(async (c, next) => {
  const raw = c.req.header(DEVICE_TOKEN_HEADER)?.replace(/^Bearer\s+/i, "");
  if (!raw) return c.json({ error: "unauthorized" }, 401);
  const row = await db.query.devices.findFirst({
    where: eq(devices.tokenHash, await sha256hex(raw)),
  });
  if (!row) return c.json({ error: "unauthorized" }, 401);
  c.set("device", row);
  void db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, row.id));
  await next();
});

// ---------- client (only native dep: expo-secure-store, which IS in Expo Go) ----------
import * as SecureStore from "expo-secure-store";

let cached: string | null = null;
export async function getDeviceToken(): Promise<string> {
  if (cached) return cached;
  const stored = await SecureStore.getItemAsync(DEVICE_TOKEN_STORAGE_KEY);
  if (stored) return (cached = stored);
  const res = await fetch(`${API}/devices`, { method: "POST" });
  const { token } = await res.json();
  await SecureStore.setItemAsync(DEVICE_TOKEN_STORAGE_KEY, token);
  return (cached = token);
}

export async function api(path: string, init: RequestInit = {}) {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      "content-type": "application/json",
      authorization: `Bearer ${await getDeviceToken()}`,
    },
  });
}
// No cookies, no Origin header, no CSRF surface, no exp:// problem, no deep links.
// Rate-limit POST /devices at the edge (Vercel WAF) — it is an unauthenticated create.
```


## リスク

- THE BIGGEST RISK IS NOT AUTH — IT IS THE SDK FLOOR. Better Auth's Expo docs require SDK 55+ / RN 0.83 / New Architecture, but Expo Go on the Apple App Store is still SDK 54 as of Sept 2026; SDK 55/56 need `eas go` + your own TestFlight team + a paid Apple Developer account. If 'Expo Go 配布' means 'scan a QR with App Store Expo Go', you are on SDK 54 and outside stated support. Mitigating fact I verified: every @better-auth/expo@1.7.5 peer range IS satisfied by expo@54.0.37, so it will probably work — but 'probably' is the operative word, and this decision constrains the whole app, not just auth. Decide the SDK target BEFORE writing auth code.
- THE SILENT-GREEN TRAP: origin validation is skipped when no Cookie header is present. A misconfigured trustedOrigins therefore gives you a perfectly working first anonymous sign-in on a fresh install, then 403 INVALID_ORIGIN on the next POST after relaunch. I reproduced this: `trustedOrigins: []` returns 200 for the first sign-in even with `Origin: https://evil.com`. Your smoke test will pass and the bug will surface at the booth. Always test the second request, with a cookie.
- `exp://*` LOOKS RIGHT AND IS WRONG. It returns 403 against the real Expo Go origin `exp://192.168.1.23:8081/--/`, because the wildcard matcher splits on `/` and `*` compiles to `[^/\\]*?`, which cannot cross the `/--/` path. Use `exp://**` (or bare `exp://`). Anyone 'fixing' the config by intuition will write `exp://*` and burn an hour.
- `exp://` and `exp://**` both trust EVERY exp:// origin — I verified `exp://evil.com/--/` returns 200 under `trustedOrigins: ["exp://"]`. There is no pattern that is both Expo-Go-proof and actually restrictive, because the Expo Go origin is your laptop's DHCP-assigned LAN IP and Expo's own docs say the URL is 'neither stable nor predictable'. `exp://192.168.*.*:*/**` is tighter but breaks the moment someone is on a 10.x network, uses `--tunnel` (exp://*.exp.direct), or runs the iOS simulator on 127.0.0.1. Accept that origin checking is decorative for this client and gate the loose pattern behind an env var so it never ships to production.
- DO NOT GATE THE exp:// ORIGINS ON `NODE_ENV`. Vercel functions always run NODE_ENV=production, so the expo() plugin's built-in dev-only `trustedOrigins: ["exp://"]` injection never fires in your deployment — and if you copy that idiom into your own config, Expo Go against the deployed API will 403 while it works fine against `pnpm --filter api dev`. Use an explicit `ALLOW_EXPO_GO_ORIGINS` env var set per Vercel environment.
- CLI PACKAGE CONFUSION WILL GENERATE A WRONG SCHEMA. `npx @better-auth/cli generate` still resolves — to version 1.4.21, three minors behind — and emits an outdated schema with no warning. The correct command is `npx auth@latest generate`. Pin it: `npx auth@1.7.5 generate`. Also note `auth generate` prints a scary 'Drizzle schema mismatch / Missing tables' ERROR on first run before succeeding; that is expected when the schema file doesn't exist yet.
- DEFAULT RATE LIMITING IS ON IN PRODUCTION WITH IN-MEMORY STORAGE. On Vercel that is per-instance, non-shared and effectively random — it will neither protect you nor behave predictably. It bit me during testing (spurious 429s across sequential runs). Set `rateLimit: { storage: "database" }`, which adds a `rate_limit` table you must include in the migration, or disable it and rate-limit at the Vercel WAF.
- @better-auth/expo's SecureStore layer has a visible bug history — colons rejected as keys (#5426), oversized cookie jars silently failing to persist and leaving useSession() null forever (#9151), chunk-marker corruption (#11082), malformed stored cookies (#6810), and an iOS crash from synchronous keychain access while the device is locked (PR #10438). All are fixed in 1.7.5, but that is five separate storage-corruption classes in one small package. The failure mode is always the same and always hostile: session silently null, no error.
- SecureStore data is scoped to the Expo Go container, so every Expo Go user on a device shares the keychain namespace with every other Expo project they have ever opened, and uninstalling Expo Go wipes all anonymous identities. For a booth demo that is fine; do not build anything durable on it.
- ANONYMOUS SIGN-IN IS NOT IDEMPOTENT. Calling signIn.anonymous() while already anonymous throws BAD_REQUEST ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY. You must getSession() first (see `ensureSession()`). A naive 'sign in on app start' will error on every relaunch.
- Every install creates a real `user` row with a synthetic unique email. There is no built-in reaping of stale anonymous users (`disableDeleteAnonymousUser` only governs the link flow). On Neon's free tier at a booth event this is fine, but add a TTL cleanup job before anything long-lived.
- Passing `fieldName: "display_name"` in additionalFields makes the CLI emit `display_name: text("display_name")` — a snake_case TypeScript property name that will leak into every call site. Omit `fieldName`; the CLI already snake_cases the column automatically.

## 結論

**Use Better Auth. It is not a trap — but the Expo Go origin problem is real, undocumented in its worst form, and you must configure around it deliberately rather than follow the docs literally.**

Concretely:

1. **Settle the Expo SDK question first, before writing any auth code.** This is the actual project risk, not Better Auth. If "Expo Go 配布" means App Store Expo Go, you are on **SDK 54** while Better Auth documents SDK 55+. I verified every `@better-auth/expo@1.7.5` peer range is satisfied by `expo@54.0.37`, so build a 30-minute spike on SDK 54 — Expo Go on a real phone, anonymous sign-in, kill the app, relaunch, sign out — and only then commit. If it fails, either move to `eas go` + TestFlight (needs a paid Apple account) or take the fallback in item 5. Write the outcome into `docs/QUESTIONS.md`.

2. **Server:** `anonymous() + bearer() + expo()` with the Drizzle pg adapter, exactly as in the `auth.ts` snippet. `expo()` is mandatory — it is what turns the `expo-origin` header into `Origin`. `bearer()` costs nothing and is your escape hatch.

3. **trustedOrigins is the one thing to get right:** `["coto2ba://", "exp+coto2ba://**", ...(ALLOW_EXPO_GO_ORIGINS === "1" ? ["exp://**"] : [])]`. Use `exp://**`, never `exp://*` (verified 403). Gate it on your own env var, **not `NODE_ENV`**, and set that var only on Vercel preview/dev — production builds use the `coto2ba://` scheme and must not trust `exp://`.

4. **Put the second-request case in CI.** The failure is invisible on a first-ever sign-in. Add a test that POSTs with a cookie present and asserts 200; my harness at `/private/tmp/claude-501/-Users-tmba-Repositories-github-com-nu-chotech-coto2ba-next/11ab5ca5-a798-4139-ae34-4203ce720867/scratchpad/gen/e2e2.mjs` is a working starting point.

5. **Generate the schema, never hand-write it:** `npx auth@1.7.5 generate --config apps/api/src/auth.ts --output apps/api/src/db/auth-schema.ts -y`, then `drizzle-kit generate`. Pin the `auth@1.7.5` version in the `pipeline:`-style script so nobody reaches for `@better-auth/cli`. Declare `display_name` as `input: true` and `best_free_moves`/`booth` as `input: false` so the server stays authoritative per CLAUDE.md.

6. **Fallback trigger, decided in advance:** if the SDK 54 spike fails, or if you hit two or more SecureStore/session-null issues during Phase 1, drop Better Auth's client entirely and ship the `POST /devices` opaque-bearer design. It is ~60 lines, needs only `expo-secure-store` (bundled in every Expo Go SDK), and has no cookie, no Origin header, no CSRF surface and no `exp://` problem. Keep the server-side `bearer()` plugin in place so this is a client-only swap, not a rewrite. For an anonymous-only word game with no OAuth and no deep links, you are using roughly 10% of Better Auth and paying 100% of its Expo surface area — so this fallback is a genuinely respectable destination, not a defeat.
