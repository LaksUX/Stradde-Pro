# Poker Night — Native App Migration Plan

Companion to `REQUIREMENTS.md`, which stays the source of truth for *what the app
does*. This file is about *how we get it onto Android and iOS* without breaking or
re-litigating what's already been decided there.

**Progress:** Phase 0 done (`src/core/money.js`, `src/core/settlement.js`, first
test coverage in the project — commit `caf84cf`). Phase 1 (Supabase + RLS) next.

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

### Schema sketch

```
games
  id, host_account_id, name, location,
  scheduled_at (timestamptz — real timestamp, not "7 Sep" text),
  rake, status ('live' | 'closed'), closed_at, created_at

game_players
  id, game_id, name, phone_e164,
  account_id (nullable — null until claimed, per identity-linking rules),
  cashed_out (bool), cashout_amount (nullable)

buyins
  id, game_player_id, amount, created_at
  -- "locked" is derived (now() - created_at >= LOCK_MS), never stored as a flag

settlement_transfers
  id, game_id, from_game_player_id, to_game_player_id, amount,
  paid (bool), paid_at, paid_by_account_id
  -- a real id, not an array index — this is what fixes the fragility flagged
  -- in REQUIREMENTS.md under Settlements ledger
```

`known_players` already exists in `supabase/schema.sql` and is unused — this is
also the moment to actually wire the roster to it, fixing the "roster is not
account-scoped" gap instead of carrying `poker-night:roster` forward as a fourth
localStorage-only store.

### RLS policies (the part that's actually new, not just a data move)

Today, "a player sees only their own numbers" is a *UI* rule, enforced by the
`viewAsHost` flag in `GameDetailScreen`. It was already found broken once at that
layer (the view-lens leakage bug). Moving to a real database means this rule has
to be enforced *again*, correctly, at the RLS layer — and this time a bug isn't a
UI glitch, it's one account reading another account's private numbers over the
network.

- Host account: full read/write on every row of games they host.
- Player account: read-only on their own `game_players` row, and on
  `settlement_transfers` where they're the `from` or `to` party. No access to
  other players' `buyins`/`cashout_amount` in a game they don't host.
- Write access to `paid`/`paid_at` on a transfer: either party to that transfer,
  matching the existing single-sided toggle decision — this is a data-layer
  version of a rule that's currently just a React handler.

**Before this phase is considered done**, write and run an explicit check (a
script or a test, not eyeballing the UI) that a non-host account genuinely cannot
read another player's buy-ins/cash-out for a game it didn't host. This is the one
place in the whole migration where "looks right in the app" is not sufficient
evidence — RLS bugs are invisible from the UI until someone goes looking.

### Open decision this phase forces

**Realtime or refetch?** Once game data is server-side, multiple devices *can*
watch the same live game (a host on their phone, someone checking on their
laptop). Supabase Realtime subscriptions would make buy-ins appear live across
devices; a simple refetch-on-focus would not, but is far less to build and debug
for a v1. Flagging this as a decision to make explicitly here rather than an
assumption either way — it changes the shape of the data layer.

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

- Realtime multi-device sync vs. simple refetch (Phase 1).
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
