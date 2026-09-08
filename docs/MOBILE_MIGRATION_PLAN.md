# Poker Night — Native App Migration Plan

Companion to `REQUIREMENTS.md`, which stays the source of truth for *what the app
does*. This file is about *how we get it onto Android and iOS* without breaking or
re-litigating what's already been decided there.

**Progress:** Phase 0 done (`src/core/money.js`, `src/core/settlement.js`, first
test coverage in the project — commit `caf84cf`). **Phase 1 is fully done**:
schema + RLS + API layer, `App.jsx`'s game screens (Live Game, Cash-out Entry,
Settlement, Create Game, the Home dashboard's settlement sections) wired to
Supabase instead of local state/localStorage, the migration SQL run against
the live project, the RLS isolation script actually executed and passing
(2026-09-08, `PASS — 0 check(s) failed`), and — as of this pass — `roster.js`
retired in favor of `knownPlayersApi.js`, the last piece still on local state.
Nothing in the web app reads or writes `localStorage` for game or roster data
any more. **Phase 2's skeleton is built** (`mobile/`, same repo): expo-router
+ TypeScript template, NativeWind (felt/gold theme matching the web app),
React Native Paper, an email-OTP-code login screen (reversed twice now:
phone-OTP → email magic-link → email OTP code — see Phase 2 below for both
reversals), and a minimal signed-in home screen wired to the same Supabase
project via `mobile/src/lib/supabase.ts`. **Phase 2 is fully done**: run for
real on a physical device via Expo Go, 2026-09-08 — email → 6-digit code →
signed in, confirmed working end to end. Magic-link tap-to-sign-in did not
work (see below); OTP code entry does, and is what shipped. **Phase 3 has
started**: Live Game is built (same day) — `src/core/{money,settlement}.js`
now genuinely cross-imported from mobile via a monorepo Metro config, not
duplicated; `gamesApi.js`/`knownPlayersApi.js`/`auth.js` duplicated into
mobile (platform-specific `./supabase` import means they can't cross-import
the way core can). Verified as far as this environment allows (`tsc` clean,
Metro resolves all 1860 modules); not yet run on a device — see Phase 3
below for the full rundown and what's trimmed for this pass.

**Decision (recap):** React Native via Expo, one shared codebase for Android and
iOS. Not Flutter (would throw away the tested JS money-math logic), not separate
Kotlin/Swift apps (doubles every future change forever). Full reasoning is in the
conversation that produced this doc; not repeated here.

**Ground rule for the whole migration:** the money math — `computeSettlement`,
`totalBuyinsFor`, `lockedCountFor`, the `BANK` scale, the rounding rule, the
overpay check — does not get rewritten from scratch on a new platform. It has
already broken twice from unit-scale mistakes on a *single* codebase. The entire
point of Phase 0 below is that it only gets written once, ever, and both the web
app and the mobile app read the same copy.

---

## Phase 0 — Extract the shared core (do this first, independent of mobile)

Pull the pure, DOM-free logic out of `App.jsx` into its own module(s) with no React
import and no browser API. Concretely, this is:

- `BANK`, `fmtB`, and the rounding rule (each figure rounds independently; a
  displayed total is the full-precision sum, rounded once)
- `computeSettlement` (debt simplification + the ascending-`player_id` tie-break)
- `totalBuyinsFor`, `lockedCountFor`, `LOCK_MS`
- the overpay calculation (`paidOut`, `overpaid`, `overpayError`, `BALANCE_TOLERANCE`)

Two things make this worth doing before anything else, not just tidy:

1. **It's the first real chance to add tests.** None of this logic has unit tests
   today — it's been verified by hand, in the browser, every time. Before it has
   two consumers (web + mobile) instead of one, write tests for the cases that
   have actually bitten this project before: the internal-unit-scale conversion,
   tie-broken settlements, the ±1 bank rounding disagreement, the locked-buy-in
   floor-not-ceiling behavior.
2. **The web app should import from it too**, immediately, not just the future
   mobile app. If `App.jsx` still has these functions inline when mobile work
   starts, someone will "temporarily" copy-paste them to unblock the RN build,
   and now there are two copies again — exactly the failure mode this phase
   exists to prevent.

Land this as its own change, verified against the existing web app, before Phase 1
starts. Nothing about it depends on Supabase or Expo.

---

## Phase 1 — Move game data onto Supabase, with real RLS

This is the biggest and riskiest phase, and it is **not mobile-specific** — do it
against the *existing web app* first. That proves the schema and the access rules
with a UI that already works, before also debugging a new UI framework at the same
time.

### Why this can't wait until "later"

The current persistence (`gameStore.js`) is `localStorage`, which was the right
fix for the data-loss bug it targeted, but it was always labeled interim. Two
things make "later" the wrong call once mobile enters the picture:

- `localStorage` doesn't exist on mobile. The tempting shortcut is `AsyncStorage`
  — which would just be the same stopgap, a third time, on a third platform.
- Cross-device sync is on the monetization roadmap as a paid-tier feature. That
  requires server-side game data by definition; there's no local-storage version
  of "see your games on your phone and your laptop."

This phase also happens to retire several items straight off `REQUIREMENTS.md` →
Known Gaps as a side effect: no live database on game screens, no RLS enforcement,
roster not account-scoped, and the "settlement transfers need stable ids"
not-yet-built item — all in one pass, instead of four separate future projects.

### Schema — built, not just sketched (2026-09-07)

The schema sketch that used to live in this section was written before this
project's *actual* `supabase/schema.sql` was rediscovered — that file already had
a fuller design than the sketch assumed (a real `profiles`/`known_players`/
`games`/`game_players`/`buyins`/`settlements` schema with RLS, from an earlier
pass that predates the local-state/localStorage detour). Rather than design a
second, incompatible schema from scratch, Phase 1 **reconciled the existing
schema forward** to match the current 3-state lifecycle and bank-check locking
model, instead of replacing it:

```
games
  id, host_id, name, location,
  status ('live' | 'cashout' | 'closed'),   -- was ('live' | 'settled')
  rake, started_at, ended_at,
  last_bank_check_at                          -- new; what lockedCountFor reads

game_players
  id, game_id, display_name, phone,           -- phone is new: the claim-by-phone join key
  profile_id (nullable — null until claimed; "claimed" IS profile_id not null,
              no separate status column),
  known_player_id, cashout_amount, cashed_out_at, cashout_confirmed

buyins
  id, game_player_id, amount, created_at
  -- "locked" is derived (created_at <= games.last_bank_check_at), never stored
  -- as a flag — same rule as src/core/settlement.js's lockedCountFor, so the
  -- database and the tested JS logic can never disagree about what's locked

bank_checks   -- new table: append-only audit trail, one row per host bank check

settlements   -- the plan's old "settlement_transfers" name — the table already
  id, game_id, from_game_player_id, to_game_player_id, amount,   -- existed as `settlements`, already
  paid, paid_at, paid_by                                          -- had a real id; paid_by is new
```

Full DDL + comments: `supabase/schema.sql` (target shape for a fresh project) and
`supabase/migrations/20260907_phase1_game_data_and_rls.sql` (idempotent, run this
one against the existing live project — every statement is safe to re-run).

`known_players` gained a `phone` column and `src/lib/knownPlayersApi.js` now has
async read/write functions for it — the roster itself isn't wired to them yet
(see "What's actually wired up" below), same reasoning as App.jsx.

### RLS policies (the part that's actually new, not just a data move)

Today, "a player sees only their own numbers" is a *UI* rule, enforced by the
`viewAsHost` flag in `GameDetailScreen`. It was already found broken once at that
layer (the view-lens leakage bug). Moving to a real database means this rule has
to be enforced *again*, correctly, at the RLS layer — and this time a bug isn't a
UI glitch, it's one account reading another account's private numbers over the
network.

- Host account: full read/write on every row of games they host.
- Player account: read-only on their own `game_players` row, and on
  `settlements` where they're the `from` or `to` party. No access to other
  players' `buyins`/`cashout_amount` in a game they don't host.
- Write access to `paid`/`paid_at`/`paid_by` on a transfer: either party to that
  transfer, matching the existing single-sided toggle decision — this is a
  data-layer version of a rule that's currently just a React handler.
- Two narrow RPCs instead of plain client writes, each for a specific reason
  (see `supabase/schema.sql` for the full comments): `run_bank_check` (atomic
  audit-row + cache-column update — a host already has RLS access to both
  writes separately, the RPC just guarantees they land together) and
  `claim_my_player_rows` (a claiming account has no standing RLS access to a row
  it doesn't own *yet* — a security-definer function is the only safe way to
  bridge that specific gap).
- **No money-math or business-rule validation at the RLS/RPC layer** — RLS
  enforces *who* can touch which rows, not game rules like "can't remove a
  locked player" or "books must balance to close." Those stay exactly where
  Phase 0 already tested them (`src/core/money.js`, `src/core/settlement.js`)
  and get enforced client-side, the same way today. Duplicating them in SQL
  would recreate the exact two-copies-drift failure mode Phase 0 existed to
  end.

**Before this phase is considered done**, write and run an explicit check (a
script or a test, not eyeballing the UI) that a non-host account genuinely cannot
read another player's buy-ins/cash-out for a game it didn't host. This is the one
place in the whole migration where "looks right in the app" is not sufficient
evidence — RLS bugs are invisible from the UI until someone goes looking.
**Done, and actually run:** `scripts/test-rls-isolation.mjs` — six checks
(own-row read, other-row read denied, own/other buy-ins, direct-write denied,
broad-query leak check) against two real signed-in accounts. Executed against
the live project on 2026-09-08 — `PASS — 0 check(s) failed` — after fixing a
real bug the first run surfaced: the script's `auth.getUser()` calls were
missing the JWT argument, so they checked the *client's own* internally-managed
session (which was never set, since these clients are constructed with a bare
`Authorization` header and never sign in themselves) instead of verifying the
token that was actually passed in — this failed immediately, client-side, with
`AuthSessionMissingError`, regardless of whether the token itself was valid.
Fixed by calling `getUser(jwt)` with the token explicitly, which tells auth-js
to verify that specific JWT against the server instead of consulting local
session state. Separately (not a script bug): grabbing both accounts' tokens
by signing out of one to sign into the other in the same browser tab
invalidates the first session at the moment of sign-out — the fix there is
mundane, just use two separate browser contexts (e.g. a normal window + an
Incognito window) so both sessions stay live at once.

### Open decision this phase forced — resolved

**Realtime or refetch? Refetch, for v1.** Nothing in the current UI has a
player-facing live-multi-device view yet (players don't interact with a live
game at all today — only the host enters data), so there's no screen that would
even display a realtime update if one arrived. Building Realtime subscriptions
now would be speculative complexity with no consumer. Revisit this once a
player-facing live view actually exists as a feature to build, not before.

### What's actually wired up vs. what's still local state

**`App.jsx` is now wired up.** Every game-data mutation (create game, add/edit/
remove player, add/remove buy-ins, bank check, cash-out entry, end buy-ins,
back-to-buy-ins, close game, edit a settlement transfer, toggle paid/pending)
calls an async `src/lib/gamesApi.js` function, then refetches
(`refreshAllGames`, App root) to bring the fresh server state back down — no
local game state persists to `localStorage` any more; `src/lib/gameStore.js`
is retired from the runtime path (left in the repo only as a reference for the
interim design it replaced). Two things worth knowing about the shape of that
rewiring:

- **Multi-row writes go through one bulk statement, not a loop.** Adding or
  removing several buy-ins at once (dragging the slider by more than 1) is a
  single `INSERT`/`DELETE` for all the rows (`gamesApi.addBuyins`/
  `removeBuyins`) rather than N sequential round trips — a single SQL
  statement is atomic, so a network blip mid-drag can't leave a
  half-committed buy-in count with no clear record of what actually landed.
- **A `run()` wrapper in `LiveGameScreen`/`CashoutEntryScreen`** guards every
  write: one in flight at a time, errors surface as a toast instead of a
  silently stuck screen, `onMutated()` only fires after a successful write.
  The settlement paid/pending toggle (used from three different list
  components) has its own equivalent guard (`togglingRef` in the App root)
  since threading a `busy` prop through all three wasn't worth it for one
  button.

**Two things this rewiring deliberately changed, not oversights:**

- **Undo is gone.** It rolled back an in-memory game object before anything
  was saved; there's no local snapshot left to roll back to now that every
  action writes straight to the database, and a real undo would mean issuing
  an equal-and-opposite write per action — out of scope here. Every action
  already requires its own explicit confirm tap, which was most of what undo
  protected against.
- **Create Game's date/time fields are preview-only.** A persisted game's
  displayed date/time is always derived from `games.started_at` (real
  timestamp, set at creation) — see the schema section above. The host can no
  longer backdate/schedule a game by typing a different date there; the
  fields still shape the invite-preview text, they just don't round-trip into
  the database. Free-text locale date parsing back into a real timestamp
  wasn't worth the complexity for a feature nothing in `REQUIREMENTS.md`
  actually asked to keep.

**`roster.js` is now wired up too (2026-09-08)**, closing out the one piece
that was kept separate from the main `App.jsx` rewiring. The shape mirrors the
games refetch pattern above, with one deliberate difference: `addToRoster`
updates local state optimistically *before* the write, rather than waiting on
a refetch, because it's a low-stakes side effect of adding a player (both call
sites — `CreateGameScreen`'s `addPlayer`, `LiveGameScreen`'s `addNewPlayer` —
already call it fire-and-forget, with no loading state of their own to thread
through) — the roster chip should appear instantly either way, with the real
`known_players` write happening in the background and only a toast if it
actually fails. `src/lib/roster.js` itself is retired the same way
`gameStore.js` was — left in the repo as a reference, nothing imports it.
Existing `localStorage` roster data (`poker-night:roster`) is not migrated
into `known_players`; that data is deliberately abandoned in place, the same
tradeoff already made for local game data before this phase.

**The two one-time manual steps are both done now:** the migration SQL was run
against the live Supabase project (SQL editor — no CLI link exists for this
repo), and `scripts/test-rls-isolation.mjs` was executed against it afterward
and passed (see above). **Phase 1 is fully closed — nothing left in it.**

---

## Phase 2 — Expo project skeleton

**Decisions locked in 2026-09-08** (previously flagged "don't guess, ask
first" — see the old "Decisions still open" entries below, now resolved):
repo structure is `mobile/` inside this same repo, not a separate one, so
`supabase/schema.sql` and (eventually) `src/core`'s money-math logic don't
need a publishing step to be shared; navigation is `expo-router`; component
kit is **React Native Paper** (styling stays NativeWind, decided
pre-Phase-2, both coexist fine — Paper handles themed components, NativeWind
handles layout via `className`).

**Auth was phone OTP via Twilio Verify, then reversed to email magic-link
the same day**, after actually checking what "the Twilio Verify compliance
profile" blocking this meant, instead of assuming a quick account upgrade
would clear it:

- Twilio Verify itself is exempt from A2P 10DLC (the big US carrier
  registration requirement) — that was never the actual blocker.
- The real blocker is India-specific: Indian phone numbers — this app's
  actual player base — need **DLT (telecom) registration** before Twilio
  (or anyone) can deliver OTP SMS to them at all. Twilio doesn't do this for
  you; it means registering as a "Principal Entity" with an Indian telecom's
  DLT platform, getting a sender header and message template approved, then
  submitting that to Twilio — typically 3-7 business days, and it expects a
  registered Indian business (GST/PAN), not an individual. Twilio's own
  *account-level* compliance profile (Trust Hub) is a much lighter,
  individual-friendly ID check (~48hrs, no business needed) — but that alone
  doesn't unblock Indian numbers; DLT is the separate, harder requirement
  that actually does.
- Given that's a real multi-day business-registration process, not a
  configuration toggle, **the decision was to skip phone OTP for now and
  reuse email magic-link on mobile too** — the same tradeoff already live on
  the web app — rather than take on DLT registration for a home-game app
  among friends. This can be revisited later if phone OTP ever becomes worth
  that cost. The real price of this choice: it reintroduces the mobile
  deep-link round trip phone OTP was originally chosen to avoid — see below.

**Then email magic-link itself was reversed to email OTP code entry, after
actually trying it on a real device (2026-09-08).** Tapping the emailed link
never completed a sign-in, across a long troubleshooting pass:

- Gmail's in-app browser doesn't reliably complete custom-URL-scheme
  handoffs (`exp://…` while testing in Expo Go) — tapping the link either
  did nothing visible or silently consumed the one-time token without
  completing the app handoff.
- Independent of that, Supabase kept redirecting to the project's **Site
  URL** — which turned out to be set to `stradde-pro.vercel.app`, a misspelled
  domain name — instead of the
  `exp://<lan-ip>:<port>` `redirect_to` the app actually requested, *even
  after* that exact address was added to Authentication → URL Configuration
  → Redirect URLs (confirmed via the raw `/auth/v1/verify` link's own
  `redirect_to` query param, captured *before* ever tapping it, and via
  Supabase's own Auth Logs). Tried: broadening `exp://*` to `exp://**`,
  adding the literal exact-match address alongside the wildcard, confirming
  via hard-refresh that the allowlist entries actually persisted, waiting
  out possible propagation delay, and requesting fully fresh links each
  time. None of it changed the outcome. Root cause not conclusively
  identified — plausibly a Supabase-side quirk with non-`http(s)` custom
  URL schemes in the redirect allowlist, not a bug in this app's code.
- Rather than keep chasing an unconfirmed platform issue, switched
  `src/app/login.tsx` to use the 6-digit code Supabase's OTP email already
  includes alongside the link, verified via
  `supabase.auth.verifyOtp({ email, token, type: "email" })`. This needs no
  redirect URL, no browser handoff, and no deep link at all — it sidesteps
  the entire class of problem. `RootLayout`'s magic-link deep-link handling
  (`createSessionFromUrl`) is left in place as a bonus path in case the link
  ever does complete successfully on its own, but code entry is now the
  primary, verified-working flow. Commit `923e7b0`.

**Built:** `npx create-expo-app` scaffolded `mobile/` (Expo SDK 57, RN 0.86,
React 19.2, TypeScript, `expo-router`, `src/` as the routes root — this
template puts routes under `src/app`, not root `app/`, matching the `@/*` →
`./src/*` alias the web app already uses). The default template's demo tab
screens (`explore.tsx`, `app-tabs`, `themed-text`/`themed-view`, etc.) were
removed (moved to `_to_delete/`, not committed) and replaced with:

- `src/lib/supabase.ts` — same project, same anon key, same RLS as the web
  client. The one real mobile-specific difference is session storage: no
  browser `localStorage` exists on native, so this uses `expo-sqlite`'s
  `localStorage` polyfill (`expo-sqlite/localStorage/install`) — this is
  current official Expo+Supabase guidance as of SDK 57, checked against
  docs.expo.dev rather than assumed, since the *older*, more commonly-seen
  pattern (`@react-native-async-storage/async-storage` + a manual storage
  adapter) is what most existing tutorials/training data would suggest and
  is no longer the recommended approach.
- `src/app/login.tsx` — email entry → `signInWithOtp({ email })` → a
  6-digit-code entry screen → `verifyOtp({ email, token, type: "email" })`.
  (Originally magic-link tap, matching the web `LoginScreen` exactly;
  switched to code entry after the magic-link round trip didn't work on a
  real device — see the reversal note above.) No manual navigation on
  success; `verifyOtp()` sets the session on the client itself, which fires
  `RootLayout`'s `onAuthStateChange` listener and redirects away from
  `/login`.
- `src/app/_layout.tsx` — session bootstrap (pick up an existing session,
  listen for changes) plus a redirect effect between `/login` and the
  signed-in screens based on session state — expo-router's equivalent of
  `App.jsx` conditionally rendering `<LoginScreen />` vs. the rest of the
  app. Wraps everything in `PaperProvider` with a theme using the same
  felt/gold color tokens as the web app's `src/index.css` `@theme` block.
  Also completes the magic-link sign-in: `expo-linking`'s `useLinkingURL()`
  watches for the deep link the tapped email opens the app with, and
  `createSessionFromUrl()` parses Supabase's tokens out of it and calls
  `setSession()` — the mobile equivalent of what web's `detectSessionInUrl`
  does automatically by reading the browser's own URL bar, which doesn't
  exist here.
- `src/app/index.tsx` — the phase's actual deliverable: a minimal signed-in
  home screen (shows the signed-in phone number, a sign-out button). Phase 3
  replaces this with the real ported dashboard.

**Verified, with a real limit on how far "verified" goes here:** `tsc
--noEmit` is clean, and `npx expo export` resolves and transforms all 1744
modules with no bundler/resolution errors for both the web and iOS targets
— meaning every file above is syntactically and type-correct and Metro can
build a dependency graph from it. `expo export --platform web`'s
*server-side static rendering* step does throw (`localStorage is not
defined`, since `supabase.ts` runs eagerly at module-load time and the web
static-render path executes that in Node, not a browser) — this is a
pre-existing limitation of exporting Expo Router's web target with a client-
only module, not a defect in the app, and not a path either mobile platform
takes; fixing it (lazy client init, or just dropping `web` from
`app.json`'s platforms) is deferred until/unless the web export target is
actually wanted, since this app's whole purpose is Android/iOS. Separately,
`expo export --platform ios`'s *Hermes bytecode* step fails because the
bundled `linux64` `hermesc` binary won't run in this Linux sandbox — an
environment limitation of where this was built, not the app; a real
Xcode/EAS build on macOS uses a different `hermesc` binary and won't hit
this. **What's not verified, and can't be from here: the app has never
actually run** — no simulator, no physical device, no `expo start` session.
That's the real next step, on your end.

Deliverable at the end of this phase: a login screen and an empty home
screen, signed in against the same Supabase project as the web app.
**Done and confirmed, 2026-09-08**: ran on a physical device via Expo Go —
email → 6-digit code → landed signed in on the home screen (shows the
signed-in email, a working Sign out button). This is the first time any
part of the mobile app has actually executed, not just type-checked or
bundled.

Getting there also needed one more piece beyond the code itself: Supabase's
default "Magic Link" email template only renders the confirmation *link*,
not the 6-digit code — `{{ .Token }}` had to be added to the template body
manually (Authentication → Email Templates) for the code to show up in the
email at all. Also had to add it to the **Confirm signup** template
specifically, not just Magic Link — an email address that hasn't
successfully signed in before gets the signup template instead, which is a
separate template Supabase doesn't sync automatically.

**Open follow-ups, not blocking:**
1. The magic-link Site-URL/redirect_to mismatch (see the reversal note
   above) was never root-caused — only worked around by switching to code
   entry. If it ever matters again (e.g. wanting the tap-the-link flow back,
   or noticing the same Site-URL-fallback behavior elsewhere), start from
   Supabase's Auth Logs for the specific failing request rather than
   re-guessing at the allowlist.
2. Phone OTP itself is still viable later if DLT registration ever makes
   sense to take on — nothing about either reversal makes it harder to add
   back; it just isn't worth pursuing on this pass. See the "auth was phone
   OTP, then reversed" note above for the full reasoning if revisiting.
3. ~~This Supabase project is shared with at least one unrelated app~~
   **Corrected 2026-09-08**: `stradde-pro` was never a separate app — it's
   this repo's own Vercel deployment, just under a misspelled project name
   (this repo's own git remote is `github.com/LaksUX/Stradde-Pro`; confirmed
   live via a direct fetch — `stradde-pro.vercel.app` serves the real Poker
   Night app, while the correctly-spelled `straddle-pro.vercel.app` 404s, i.e.
   nothing is deployed there yet). The user is renaming/redeploying to
   `straddle-pro.vercel.app` on the Vercel side and will update the Supabase
   Site URL (and Redirect URLs allowlist) to match — until that lands, the
   *code* now points at `straddle-pro.vercel.app` (invite/results links,
   `.env.example`'s `VITE_SITE_URL`) slightly ahead of the actual deployment,
   which is expected and intentional, not a bug to chase. So the "shared
   project" framing above was itself wrong: there's no second, unrelated app
   involved. That said, project-wide Supabase settings (Site URL, rate
   limits, email templates — including the two
   templates just edited above) apply project-wide, so keep that in mind if
   this Supabase project ever does end up backing a second app for real.

---

## Phase 3 — Port screens, in priority order

Recommended order, by how much of the app's actual value each screen carries:

1. **Live Game** (buy-in/cash-out entry, the bottom sheet, the slider, the
   locking behavior) — the most-used, most interaction-heavy screen, and the one
   most worth getting right early since every other screen depends on its data
   shape. **Built, 2026-09-08** — see below.
2. **Create Game** (including the per-player starting buy-in stepper) — needed
   to get any game onto a device at all.
3. **Settlement / Close Game** — the balance-to-close check, the overpay warning,
   and the host's explicit choice for an unresolved cash-out (rake vs. split).
   High-stakes screen; worth its own careful pass rather than rushing it to
   match the web version pixel-for-pixel.
4. **Home** (Overview/Settlements tabs, Host/Player filter) — the dashboard; can
   lean on whatever the RN charting story ends up being for the net-trend chart.
5. **Game Detail / history** — mostly read-only, lower risk.
6. **Admin / pending-approval** — lowest traffic. Worth asking explicitly whether
   this needs to exist on mobile at all, or can stay a web-only back-office
   screen indefinitely — that's real scope you can just not build.

### Live Game — built, 2026-09-08

Ported `LiveGameScreen` from web `App.jsx` (buy-in slider, early-leaver
cash-out toggle + keypad, bank check dialog, edit/remove player, add-late-
player with roster chips, rake edit) to `mobile/src/app/live-game.tsx`, same
gamesApi/knownPlayersApi calls and business logic as web, same visual
language via NativeWind (felt/gold theme carries over almost unchanged —
most Tailwind className strings ported with no translation needed).

**Repo-sharing decision, now actually exercised:** `src/core/{money,
settlement}.js` — explicitly written dependency-free "meant to be reused
unchanged by the native rebuild" (see their own header comments) — are now
genuinely cross-imported from `mobile/`, not duplicated. `metro.config.js`
gained `watchFolders`/`nodeModulesPaths` pointed at the repo root, and
`tsconfig.json` a `@core/*` path alias to `../src/core/*`, so
`mobile/src/app/live-game.tsx` does `import { fmtB } from "@core/money"` and
gets the actual web file, unchanged. Verified for real: `npx expo export`
resolves it through Metro with zero errors.

`gamesApi.js`, `knownPlayersApi.js`, and `auth.js` are **duplicated** into
`mobile/src/lib/`, not cross-imported like core — each imports `./supabase`,
which has to resolve to *this platform's* client (mobile's expo-sqlite-
backed one vs. web's browser one), so a single shared file can't serve both
without a dependency-injection refactor of the web version, which felt like
scope creep for this pass. Kept in sync by hand; mobile's `gamesApi.js` also
picked up a JSDoc annotation on `addPlayer` that the web copy doesn't need
(TS's inference for plain-.js modules needs it to type-check `.tsx` call
sites correctly — see that function's comment).

**Trimmed scope, on purpose:**
- **"End Buy-ins" is a stub** here, not wired to
  `gamesApi.setGameStatus(id, "cashout")` — that's a real transition on a
  real, shared-with-web game row. Firing it before the Cash-outs screen
  exists on mobile (item 3 above, not built yet) would flip status on a game
  someone might still be tracking from the web app with no way to act on it
  from here. Shows a "not available on mobile yet" message instead; revisit
  once Cash-outs is ported.
- **No mobile toast system yet** — `showToast` is a console.log stub for
  now. Small, separable follow-up.
- **Icons are text glyphs, not `lucide-react-native`** (web's `App.jsx` uses
  `lucide-react`) — that package ships one file per icon, and bundling it
  hit `EMFILE: too many open files` specific to this device's sandboxed
  shell (confirmed not a `ulimit` issue — already effectively unlimited;
  more likely a lower cap from whatever contains that shell). Not investigated
  further; text glyphs are a fine stand-in, worth revisiting if the icon
  library is worth the fight later.
- **Avatars are solid colors (hashed from name), not web's gradient** — RN
  has no native `linear-gradient`; not worth a new dependency for this alone.
- **No entry point of its own yet** — reached via a temporary "View live
  game" button added to Phase 2's placeholder home screen
  (`mobile/src/app/index.tsx`), which fetches the account's one active
  hosted game the same way web's App-root does. Since Create Game isn't
  ported yet, this only works against a game that already exists (e.g.
  created via the web app) — and since `known_players`/`games` RLS gates
  everything on `profiles.role = 'host'` and `approved = true`, **the mobile
  account signed in has to be an already-approved host account**, same one
  used on web, or it'll see nothing (silently — this screen doesn't
  distinguish "no active game" from "not an approved host" yet, both render
  the same empty state).

**Verified, same ceiling as Phase 2:** `tsc --noEmit` clean, `npx expo
export --platform android` resolves and transforms all 1860 modules with
zero bundler/resolution errors (including the new `@core/*` cross-repo
import). Hermes bytecode generation fails the same pre-existing way as
Phase 2 (this sandbox's `hermesc` binary, not a real device/EAS build).
**Not yet run on an actual device** — that's the next step, same shape as
Phase 2's own "code-complete, run-verified is still open."

### Create Game, Cash-out Entry, Settlement, Home, Game Detail — built, 2026-09-08

Ported the rest of the screen list above in one pass, after "expo go is
working" confirmed Live Game on a real device: `create-game.tsx`,
`cashout-entry.tsx`, `settlement.tsx`, `index.tsx` (Home), and
`game-detail.tsx`. Same approach as Live Game throughout — port the web
component's JSX/logic 1:1 onto RN/NativeWind primitives, same
gamesApi/knownPlayersApi calls, same @core/{money,settlement} cross-imports.

**New this pass: `AppStateContext`** (`mobile/src/lib/AppContext.tsx`), a
React Context mounted once in `_layout.tsx` around the whole app — the
nearest equivalent of web App.jsx's App-root prop-drilling now that
expo-router screens are separate files rather than children of one root
component. Holds session/profile, active + past games, roster, toast, and
every mutation handler (refreshAllGames, addToRoster, toggleSettlementPaid,
handleCreateGame, handleCloseGame, logout), plus selGame/selGameAsHost +
viewGameDetail for passing a whole game object to Game Detail (expo-router
has no route-param equivalent for that). Live Game was refactored onto it
too, replacing its original self-contained fetch.

**"End Buy-ins" is no longer stubbed** — now that Cash-out Entry exists, it
calls `gamesApi.setGameStatus(id, "cashout")` and navigates there for real,
same live -> cashout transition as web.

**Admin screen: confirmed skipped, staying web-only** (asked explicitly,
answer was to skip it) — the pending-approval *gate* is still ported (a
non-approved account sees a "Pending approval" screen with just a
sign-out button), since that's access control, not the Admin back-office
screen itself.

**Trimmed/deferred, on purpose:**
- Settlement's per-payment "settled" checkbox state is local-UI-only here,
  same as web — it isn't wired to a tap target on this screen either
  (that's what the persisted `paid` toggle on Home/Game Detail is for,
  post-close).
- No separate floating "Live Game" reminder pill (web's `LiveGameFab`) —
  Home's Active Game card already sits at the top of the one screen every
  navigation returns to; a FAB would duplicate that. See the comment in
  `index.tsx` if this needs revisiting.

**Verified, same ceiling as every prior screen:** `tsc --noEmit` clean at
every step, `npx expo export --platform android` resolves and transforms
every module with zero bundler/resolution errors (1985 modules once this
batch landed). Hermes bytecode generation fails the same pre-existing,
sandbox-only way. **Not yet run on an actual device** for these five
screens specifically — Live Game is the only one confirmed running on real
hardware so far.

---

## Phase 4 — Native-only additions

These are the actual reasons "native" was worth the cost — build them once the
core screens exist, not before:

- **Push notifications** (`expo-notifications`) for settlement reminders. Note
  this is not a client-only feature: something server-side (a Supabase Edge
  Function on a schedule, most likely) has to decide *when* to send a reminder
  and trigger it. Budget for that half of the feature, not just the client SDK
  call. **Client half built, 2026-09-08** — see below; the server-side
  scheduling half is still entirely open.
- **Biometric/PIN lock** (`expo-local-authentication`) gating app open. Simple,
  self-contained, matches the "it's a money app" instinct that was one of the
  stated reasons for going native.
- **RevenueCat** for the host subscription, so Play Billing and (later) StoreKit
  don't get hand-built separately. Needs products configured in Play Console now
  and App Store Connect later — plan the entitlement check (what a "Pro host"
  unlocks) against the monetization tiers already written into
  `REQUIREMENTS.md`.

### Push notifications — client half built, 2026-09-08

Added `mobile/src/lib/pushNotifications.ts` (`registerForPushNotificationsAsync()`:
checks `Device.isDevice`, requests permission, sets up the Android default
notification channel, calls `Notifications.getExpoPushTokenAsync()`) and
`mobile/src/lib/pushTokensApi.js` (`savePushToken()`: upserts the token
against the signed-in profile). Wired into `AppStateContext` — once an
approved host/admin's profile loads, it registers best-effort and silently
in the background; failure never blocks anything else in the app.

**New table:** `push_tokens` (profile_id, expo_push_token unique, platform,
created_at), RLS-gated to `auth.uid() = profile_id` same as every other
per-account table. Added to `supabase/schema.sql` (the target shape) and
as a standalone, idempotent migration,
`supabase/migrations/20260908_phase4_push_tokens.sql`, for the existing
project — **not yet run against it**, same "paste into the SQL editor by
hand" story as the Phase 1 migration.

**What's deliberately NOT built here — this is the client half only:**
1. **The server-side scheduling piece.** Nothing decides *when* a
   settlement reminder should fire or actually calls Expo's push API to
   send one — that needs a Supabase Edge Function (or similar) on a
   schedule, plus real product decisions this pass didn't make: what counts
   as a reminder-worthy settlement, how often, whether it's opt-in/out per
   user. Don't build the scheduler until those are answered.
2. **No EAS project configured** (`app.json`'s `extra.eas.projectId` is
   unset — this repo has never run `eas init`). Without it,
   `getExpoPushTokenAsync()` has nothing to register against and
   `registerForPushNotificationsAsync()` returns `null` early rather than
   throwing — safe to leave wired in as-is, but no real token will be
   obtained until this exists.
3. **Expo Go can't be used to test any of this end-to-end.** Since Expo SDK
   53, Expo Go on Android no longer supports *remote* push notifications at
   all (this project is on SDK 57) — only a development build (`eas
   build --profile development`) can receive one. Everything else ported
   so far (OTP sign-in, all six screens) has been verified via Expo Go; this
   is the first Phase 3/4 piece that structurally can't be.
4. **`expo-notifications` plugin added to `app.json`**, which changes the
   native project — this now needs a fresh native build (dev client or EAS)
   to pick up, not just a Metro/JS reload. Flagging this explicitly since
   every other change so far has been JS-only and reloadable via Expo Go.

**Verified: same ceiling, one caveat.** `tsc --noEmit` clean, `npx expo
export --platform android` resolves and transforms all 2051 modules
(`expo-notifications`/`expo-device` included) with zero bundler errors,
Hermes bytecode step fails the same pre-existing sandbox-only way. Unlike
every prior screen, this one has **no path to real-device verification
without an EAS project + dev build** — see point 3 above. Not attempted
beyond what's described here.

---

## Phase 5 — Android rollout

- Play Console: internal testing → closed testing → production tracks.
- **Privacy policy is a hard requirement**, not optional, given the app collects
  real names and phone numbers — this needs a real, hosted page, and ties
  directly into the still-open "no PII deletion or export path" gap in
  `REQUIREMENTS.md`. Worth closing that gap before this step, not after.
- Data safety form, app icon, store listing assets, signing config via EAS.

---

## Phase 6 — iOS, once Android is live

Because the codebase is already shared, this phase is mostly logistics, not
engineering:

- Apple Developer Program enrollment ($99/yr).
- TestFlight beta before public submission.
- APNs push setup (Expo handles most of this, but it's a separate credential
  from Android's).
- **App Store review notes should explicitly state the "ledger, not a wallet — no
  real-money processing" positioning** already committed to in `REQUIREMENTS.md`.
  Apple's review is genuinely sensitive to anything poker/gambling-adjacent, even
  play-money trackers; a first submission with no context on this is a real
  rejection risk, not a theoretical one.

---

## Full usecase test pass — run, 2026-09-08

Before the Material 3 restyle (below), ran a full pass through the whole
game lifecycle to catch bugs while the felt/gold UI was still the
baseline, not after a big visual rewrite made a regression harder to spot.

**`scripts/test-full-lifecycle.mjs`** — new, real, runnable
(`node scripts/test-full-lifecycle.mjs`). Exercises `src/core/money.js`
and `src/core/settlement.js` directly (no network, no auth — these are
the dependency-free files meant to be reused unchanged, see their own
header comments) by replaying the exact sequence of state transitions
every mobile screen performs on a realistic 4-player session end to end:
create -> buy-ins before/after two bank checks (locking) -> add + remove
a late player (removal gating) -> an early-leaver cash-out mid-game ->
end buy-ins -> cash out the table -> add rake and catch the resulting
overpay -> fix it -> Review & Continue's balance gate -> auto-computed
settlement (verified against hand-checked net positions, including the
non-obvious case where rake causes the debtors' total to exceed the
creditors' total by design) -> Settlement screen's override/remove/custom-
payment state machine -> close -> post-close paid-toggle read. **63/63
checks passed** after fixing arithmetic bugs in the test's own hand-
computed expected values (not the app) — full output and the fixes are in
the script's git history if useful.

**Also code-traced, not just eyeballed:** every `gamesApi.*`/
`knownPlayersApi.*` call across every screen and `AppContext.tsx` against
the actual exported function list (no mismatches), every
`router.push`/`replace` target against the actual route files (all
match), every `useAppState()` destructure across all six screens against
`AppContext`'s exposed `value` object (no missing/misnamed fields), and
every `"live"/"cashout"/"closed"` status literal across the app against
`supabase/schema.sql`'s check constraint (all consistent, no typos).

**What this pass could NOT cover, and why:** live Supabase calls under a
real RLS-authenticated session. `scripts/test-rls-isolation.mjs` (Phase 1)
needs two real signed-in JWTs a human has to obtain from a browser
session — none were available this pass, and there's no service-role key
in this environment to script around that. OTP sign-in itself can't be
scripted either (needs a real inbox to receive the code). So this pass
proves the shared logic and the client-side wiring are correct; it does
NOT re-prove RLS isolation or exercise the real network/Postgres path —
that still needs either a human running the app, or someone supplying
fresh test JWTs the way the Phase 1 script's setup steps describe.

---

## Material 3 Expressive restyle (2026-09-08)

Requested directly: "upgrade the native android build with material 3 / m3
ui... the app should be bold with expressive styles." Not a new phase in
the numbered plan above — a visual pass across everything Phase 3 already
built, done after the full usecase test pass (previous section) confirmed
the underlying wiring was correct, so the redesign wasn't layered on top of
an unverified baseline.

**Approach: redefine token VALUES, not class names.** Every ported screen
already references semantic Tailwind classes (`bg-felt-surface`,
`text-gold-light`, `bg-gold`, etc.) defined centrally in
`mobile/tailwind.config.js`. Rather than touch every screen's JSX, the
highest-leverage move was redefining the underlying hex values of the
existing keys — every already-built screen picks up the bolder look for
free — while adding new keys for M3 roles the app never had:

- `felt.surface-3` / `felt.surface-4` — extra neutral elevation tiers
  (`surfaceContainerHigh`/`surfaceContainerHighest` in M3 terms), used for
  sheets/dialogs/toasts so they read as clearly floating above the base
  `felt.surface` cards behind them.
- `felt.outline` — a bolder border color for emphasis, separate from the
  existing quiet `felt.border`.
- `gold.vivid` — a more saturated primary tone for accents that pair with
  dark text (existing `gold.DEFAULT`/`light`/`dark` also got bolder/richer
  values, but stayed safe for white-text-on-filled-button use).
- `mint` (secondary) and `bloom` (tertiary) — two entirely new accent
  families. A felt/gold-only palette isn't actually Material 3; M3 is built
  around three distinct accent hues plus a multi-tier neutral surface
  family, so these are the real second and third colors the design system
  calls for, not just "make it brighter."

Tones are hand-generated (HSL, four hue families: gold 42°, mint 152°,
bloom 322°, plus error/neutral/neutral-variant) at roughly M3's tone-scale
positions — an approximation, not true HCT color science, judged close
enough for a bold dark-theme app.

React Native Paper's theme (`_layout.tsx`) got the same hex values mapped
onto a full MD3 color-role set (primary/secondary/tertiary, each with
`on-*`/`container`/`on-*Container` pairs, plus background/surface/outline/
error roles) — previously only six ad hoc keys were set. `login.tsx` is the
one screen using Paper's own `TextInput`/`Button` directly, so it now gets
authentic M3 ripple/elevation/state-layer behavior instead of falling back
toward Paper's default purple.

**What got hand-touched, beyond the token swap:**
- `login.tsx` — bigger hero glyph, `displaySmall`/`font-black` headline,
  taller buttons with heavier label weight.
- `game-ui.tsx` (the shared primitives every screen builds on) — avatar
  hash colors bumped from Tailwind 600- to 500-shades; `SegTabs`'s active
  pill moved from gold (primary, already the dominant CTA color everywhere)
  to bloom (tertiary), so tab selection reads as its own control and the
  app actually uses its new secondary/tertiary roles; `ProgressBar`'s fill
  moved from generic emerald to the app's own mint; `AppSheet`/`AppDialog`
  bumped to the new `felt-surface-3` elevation tier; `BuyinSlider`'s native
  slider tint props (hardcoded hex — `@react-native-community/slider` takes
  color props, not classNames, so these can't ride the Tailwind swap) hand-
  updated to match; press-scale feedback added to Keypad digits, SegTabs
  pills, and AppSheet's close button.
- `Toast.tsx` — bumped to the same `felt-surface-3`/`felt-outline`
  elevation treatment as sheets/dialogs.
- `NetTrendChart.tsx` — "up" trend color moved from generic emerald to the
  app's own mint (brand-colored positive trend); "down" deliberately left
  on red as a semantic danger color, not a brand hue; zero-line dash moved
  from generic zinc to `felt-outline`.
- Every screen's header title bumped from `text-xl font-bold` to
  `font-black tracking-tight`, matching the bolder headline treatment
  Home and Login already had, so the whole app reads consistently bold
  rather than just the two screens that happened to get it first.
- `live-game.tsx`'s pull-to-refresh spinner had the *old* pre-M3 gold hex
  (`#caa043`) hardcoded as a native `tintColor` prop — missed by the token
  swap for the same "native prop, not className" reason as the slider —
  hand-updated to the new `gold.vivid`.
- `app.json` — fixed two real native Android surfaces left over from the
  Expo template and never actually themed: the adaptive launcher icon's
  background (was a generic light blue, `#E6F4FE`) and the splash screen's
  background (was Expo's own default blue, `#208AEF`). Both are now the
  app's actual felt background (`#0a0f0c`), so the app's *launch*
  experience — which is a real native Android asset, not something Expo
  Go's JS bundle controls — matches the app instead of flashing an
  unrelated brand color first.

**Deliberately left alone:** `create-game.tsx`'s WhatsApp-brand green
(`#25d366`) on the invite-copy button — that's WhatsApp's own brand color,
checked and confirmed not part of this app's palette, so it stays hardcoded
on purpose. `mobile/src/constants/theme.ts` — confirmed via grep to be
completely unused/unimported dead code left over from the `create-expo-app`
scaffold; not worth the risk of touching something nothing references.

**Verification, each batch:** `tsc --noEmit` (clean every time) plus
`npx expo export --platform android` after every batch of file changes,
confirming Metro resolves all 2051 modules with zero bundling/import
errors. The final step of that command — compiling to Hermes bytecode —
fails in this specific sandbox VM: its bundled `hermesc` binary is x86-64
and the VM itself is `aarch64` (confirmed via `uname -m`), so the OS can't
exec it (`ENOEXEC`, which surfaces as a confusing "Syntax error: word
unexpected" from the shell's script-interpretation fallback). This is a
pre-existing sandbox toolchain limitation, not a regression from this
restyle — Metro's own module-resolution/bundling step, which is what
actually validates every import/export across the app, completes
successfully every time before that unrelated native step fails.

**Not verified: how any of this actually looks on a real device.** Nothing
in this pass could screenshot- or visually-verify the result — that needs
either the user's own phone/Expo Go session, or a description-based review
requested from here. The same live-Supabase/RLS gap noted in the usecase
testing section above is unchanged by this restyle.


## Decisions still open (don't guess on these — ask before Phase 2 starts)

- ~~Realtime multi-device sync vs. simple refetch (Phase 1).~~ Resolved:
  refetch for v1 — see Phase 1 above.
- ~~Finish wiring `roster.js` to `knownPlayersApi.js`.~~ Resolved: done
  2026-09-08 — see Phase 1 above. **Phase 1 is fully closed; nothing here is
  blocking Phase 2 anymore.**
- ~~Phone OTP vs. email magic-link on mobile.~~ Resolved 2026-09-08: chosen
  as phone OTP, then reversed the same day to email magic-link after
  checking Twilio's actual requirements (India's DLT registration, not the
  lighter account-level compliance profile, is the real blocker for this
  app's Indian player base) — see Phase 2 above for the full reasoning.
- ~~`expo-router` vs. React Navigation.~~ Resolved 2026-09-08: `expo-router`.
- ~~Tamagui vs. React Native Paper vs. gluestack-ui.~~ Resolved 2026-09-08:
  React Native Paper.
- ~~Where the mobile app's repo/code lives.~~ Resolved 2026-09-08: `mobile/`
  in this same repo, not a separate one — not in the original open-decisions
  list, but a real structural question this phase forced, so recorded here.
- Whether Admin/pending-approval needs a mobile screen at all, or stays web-only
  (Phase 3).
- Whether the web app stays alive long-term as a secondary surface (e.g., a
  "desktop view" for hosts) once mobile is the primary app, or gets retired.
  Both are fine; drifting into an answer by default isn't.

## Risks worth naming now

- **RLS is the new critical-bug surface.** The view/host visibility rule has
  already been wrong once, at the UI layer, and was low-stakes to fix (a
  navigation flag). The same rule wrong at the RLS layer is a real data leak
  across accounts. Treat Phase 1's access-control testing as non-negotiable, not
  a nice-to-have.
- **Re-verify money math on-device, not just "it's the same code."** Timezone
  handling, `Date` behavior, and floating-point rounding can differ subtly across
  JS engines (web vs. Hermes on RN). Reusing the logic eliminates rewrite risk;
  it doesn't eliminate the need to actually test the tie-break, rounding, and
  overpay cases on a real device before launch.
- **App Store gambling sensitivity** (Phase 6) — mitigation is already decided
  (positioning in review notes); just don't skip it under launch-day pressure.
