# Poker Night — Native App Migration Plan

Companion to `REQUIREMENTS.md`, which stays the source of truth for *what the app
does*. This file is about *how we get it onto Android and iOS* without breaking or
re-litigating what's already been decided there.

**Progress:** Phase 0 done (`src/core/money.js`, `src/core/settlement.js`, first
test coverage in the project — commit `caf84cf`). Phase 1 is now fully done for
the web app: schema + RLS + API layer, and `App.jsx`'s game screens (Live Game,
Cash-out Entry, Settlement, Create Game, the Home dashboard's settlement
sections) are wired to Supabase instead of local state/localStorage. `roster.js`
is the one piece deliberately still local — see its own Phase 1 note — and the
DB migration still needs to be *run* against the live project plus the RLS
isolation script actually executed once (see "What's actually wired up" below).

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
**Done:** `scripts/test-rls-isolation.mjs` — six checks (own-row read, other-row
read denied, own/other buy-ins, direct-write denied, broad-query leak check)
against two real signed-in accounts. Needs to actually be *run* once against the
live project after the migration is applied — see the script's own header for
the two-JWT setup, which needs a person to sign in twice, so it isn't something
this migration pass could run unattended.

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

**`roster.js` is the one piece still not wired up** — still 100% synchronous
`localStorage`, with `src/lib/knownPlayersApi.js` sitting ready as its async
replacement (see that file's own Phase 1 note). It was kept separate from the
`App.jsx` rewiring because every call site is synchronous today
(`CreateGameScreen`, "Add late player"), and converting those to handle an
async/loading roster is a self-contained follow-up, not free to fold into an
already-large change.

**Still needs a human, not more code:** the migration SQL has to actually be
*run* once against the live Supabase project (SQL editor — no CLI link exists
for this repo), and `scripts/test-rls-isolation.mjs` has to actually be
*executed* once against it afterward (needs two real accounts' session
tokens — see the script's header). Both are one-time, manual steps; nothing
about them can be scripted from here.

---

## Phase 2 — Expo project skeleton

- `npx create-expo-app`, set up an EAS project (this is what lets Android and
  iOS both build from CI without needing a Mac for most of the work).
- Auth: wire `@supabase/supabase-js` the same way the web app does. Decide
  email-magic-link vs. phone-OTP for mobile specifically — magic links mean deep
  link handling on mobile (more friction than a web redirect), so this is a
  reasonable point to revisit phone OTP now that a Twilio Verify compliance
  profile may have moved since it was last blocked. Worth a five-minute check
  before assuming email carries over unchanged.
- Navigation: React Navigation or `expo-router`. Recommend `expo-router` — it
  matches the file-based-routes mental model and has first-class Expo/EAS
  support, and this app's screen count is small enough that the choice mostly
  comes down to preference, not capability.
- Styling: NativeWind, so Tailwind utility-class habits from `App.jsx` transfer
  directly instead of learning a new styling API.
- Component kit: pick one of Tamagui / React Native Paper / gluestack-ui *before*
  writing the first real screen — this replaces what Radix (`Dialog`, `Tabs`,
  `Switch`, `Slider`, `Sheet`) provided on web, and swapping kits mid-project
  means redoing every screen's primitives twice.

Deliverable at the end of this phase: a login screen and an empty home screen,
signed in against the same Supabase project as the web app.

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
- **Finish wiring `roster.js` to `knownPlayersApi.js`** before starting Phase
  2 — `App.jsx` itself is done, this is what's left. Small in isolation, but
  Expo screens should still be built against a data layer that's fully proven
  on the web app first, not one with a known remaining gap.
- **Actually run the migration SQL and the RLS isolation script** against the
  live Supabase project (see "What's actually wired up" in Phase 1 above) —
  both are one-time manual steps, neither has happened yet.
- Phone OTP vs. email magic-link on mobile (Phase 2).
- `expo-router` vs. React Navigation (Phase 2) — low-stakes, pick one and move.
- Tamagui vs. React Native Paper vs. gluestack-ui (Phase 2) — pick once, don't
  revisit mid-project.
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
