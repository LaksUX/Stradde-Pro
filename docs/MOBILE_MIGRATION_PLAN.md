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
project via `mobile/src/lib/supabase.ts`. **Run on a real device for the
first time this pass** — magic-link tap-to-sign-in did not work end to end
(see below), OTP code entry does.

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
  URL** — which turned out to be set to an unrelated app (`stradde-pro`,
  a different project sharing this same Supabase backend) — instead of the
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

Deliverable at the end of this phase: a login screen and an empty home screen,
signed in against the same Supabase project as the web app. **Code-complete;
run-verified is still open** — see "Still needs a human" below.

**Still needs a human to confirm:** try the new OTP-code flow end to end —
`npx expo start` + Expo Go on a real device, email → 6-digit code → should
land signed in on the home screen. This is what the magic-link version
never managed to do; the code-entry version is expected to work but hasn't
been confirmed on-device yet as of this edit.

**Still open regardless of the above:**
1. The magic-link Site-URL/redirect_to mismatch (see the reversal note
   above) was never root-caused — only worked around. If it ever matters
   again (e.g. wanting the tap-the-link flow back, or noticing the same
   Site-URL-fallback behavior elsewhere), start from Supabase's Auth Logs
   for the specific failing request rather than re-guessing at the
   allowlist.
2. Phone OTP itself is still viable later if DLT registration ever makes
   sense to take on — nothing about either reversal makes it harder to add
   back; it just isn't worth pursuing on this pass. See the "auth was phone
   OTP, then reversed" note above for the full reasoning if revisiting.
3. This Supabase project is shared with at least one unrelated app
   (`stradde-pro` — its Site URL is set to that app's Vercel deployment,
   discovered via Auth Logs while debugging the above). Worth being
   deliberate about whether that's still the right setup, since project-wide
   settings (Site URL, rate limits, email templates) affect both apps.

---

## Phase 3 — Port screens, in priority order

Recommended order, by how much of the app's actual value each screen carries:

1. **Live Game** (buy-in/cash-out entry, the bottom sheet, the slider, the
   locking behavior) — the most-used, most interaction-heavy screen, and the one
   most worth getting right early since every other screen depends on its data
   shape.
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

---

## Phase 4 — Native-only additions

These are the actual reasons "native" was worth the cost — build them once the
core screens exist, not before:

- **Push notifications** (`expo-notifications`) for settlement reminders. Note
  this is not a client-only feature: something server-side (a Supabase Edge
  Function on a schedule, most likely) has to decide *when* to send a reminder
  and trigger it. Budget for that half of the feature, not just the client SDK
  call.
- **Biometric/PIN lock** (`expo-local-authentication`) gating app open. Simple,
  self-contained, matches the "it's a money app" instinct that was one of the
  stated reasons for going native.
- **RevenueCat** for the host subscription, so Play Billing and (later) StoreKit
  don't get hand-built separately. Needs products configured in Play Console now
  and App Store Connect later — plan the entitlement check (what a "Pro host"
  unlocks) against the monetization tiers already written into
  `REQUIREMENTS.md`.

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
