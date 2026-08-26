# Poker Night — Requirements

This is the source of truth for what the app does and why. Edit this file when a
requirement changes — the page-level prompts in `PAGE_PROMPTS.md` should be kept in
sync with whatever's decided here.

> **Revision note:** This pass closes several loopholes found during a pre-build
> review (identity linking, stake definition, rake formula, game lifecycle, edit/lock
> rules). Where a judgment call was made rather than dictated by prior text, it's
> marked **[decision]** so it's easy to spot and revisit.

## What this is

A money-tracking app for home poker games. A host runs a game, tracks each player's
buy-ins and cash-out, the app works out who owes whom, and everyone can see their own
history over time. No real-money payment processing — it's a ledger, not a wallet.

## Access model

- **Super admin** (the app owner) approves who is allowed to be a **host**. Nobody can
  create a game without admin approval — this keeps random signups from spinning up
  games.
- A **host** creates and runs games, and can also be a **player** in their own game.
- A **player** is added to a game by a host (name + phone number, captured at game
  creation). Players do not need admin approval — they're implicitly trusted by being
  invited into a specific game.
- Auth is currently **email magic-link** (interim). The intended long-term method is
  **phone OTP via Twilio Verify** — blocked for now on Twilio trial-account
  restrictions (can only send to pre-verified numbers until the Compliance Profile is
  approved). Swap back to phone once that's sorted; the data model doesn't change
  either way.
- **[decision] Phone numbers are normalized to E.164 format** (e.g. `+15550142`) on
  entry, everywhere they're captured (player creation, future OTP). This is the join
  key for identity linking below, so it must be consistent — no dedup logic needs to
  exist yet, but the format has to be canonical from day one.

### Player identity vs. account linking

A player row (name + phone, created by a host) is not automatically the same thing as
a logged-in account. Since the Player tab shows "this account's own results across
every game they've played in," every player row needs a defined path to an account.

- Every player row has a status: **`unclaimed`** or **`claimed`**, plus a nullable
  `account_id`.
- **[decision] Claiming happens on login by phone match:** when someone signs in
  (email magic-link today, phone OTP later) and their profile's phone number matches
  an `unclaimed` player row's phone number, that row is auto-linked to their
  `account_id` and flipped to `claimed`. This means the profile needs a phone number
  field captured at signup even though auth itself is email-based right now.
- An `unclaimed` player row still fully participates in a live game (buy-ins,
  cash-out, settlement) — claiming only affects whether the row later shows up under
  that person's Player tab. A player who never signs up still has correct numbers in
  the host's view; they just never see their own history.
- If a phone number gets reused by a different real person across different games,
  claiming can attach a stranger's old game to the wrong account. Out of scope to
  solve now — noted under Known gaps.

## Money model

- **1 bank = 10,000** internal units. All UI amounts are expressed in banks, never in
  a currency symbol.
- **[decision] Buy-in amount is a game-level field, set by the host at game
  creation** (e.g. "2 banks per buy-in"), and applies uniformly to every player in
  that game — there's no per-player custom buy-in amount. This is the "stake" that
  the dashboard's net-trend chart later splits by (see Dashboard section) — it didn't
  have an explicit home before this revision.
- Every player starts a game with **exactly 1 buy-in** automatically, at the game's
  buy-in amount — there's no "buy-in amount per player" decision at game creation,
  only the one game-wide amount above.
- Display amounts as **whole banks, no decimals** (e.g. "12 banks", not "12.4"). Only
  the display layer rounds — all stored/calculated amounts stay full-precision.
  - **[decision] Rounding rule:** each individual figure (a player's buy-ins,
    cash-out, net) is rounded independently for display. A displayed total (e.g. sum
    of all buy-ins shown on a summary) is computed from the full-precision sum and
    *then* rounded once — it is not the sum of the already-rounded per-player
    numbers. The two can legitimately disagree by ±1 bank in the UI; that's expected
    and not a bug.
- Buy-ins **lock 1 minute** after being entered — a host can't accidentally undo a
  buy-in a player already paid in. The slider used to add buy-ins can never be dragged
  below the already-locked count.
  - **[decision] Locked buy-ins are permanent — no override, including for admins.**
    If a host makes a genuine mistake (wrong player, wrong count) within the lock
    window they can fix it; after the lock, the only remedy is entering a correcting
    note or handling it as cash outside the app. This is a deliberate trust/integrity
    tradeoff (an editable "locked" value isn't really locked) and should be stated to
    hosts in-product, not just assumed.
- Once a player's cash-out is being entered, their buy-ins are **locked** — no more
  buy-ins for that player while cashing out.
- **[decision] A cash-out can be edited freely until the game is closed** (see Game
  lifecycle below), unlike buy-ins. Cash-out entry is inherently a one-time "count the
  stack" event that's more error-prone than a buy-in tap, so hosts need a correction
  window. Once the game closes, cash-outs lock permanently along with everything else.

### The rake/settlement invariant

This is the one formula everything else depends on — get it wrong and every payout is
wrong:

```
sum(all players' buy-ins) = sum(all players' cash-outs) + rake
```

- **Rake** is a single fixed amount the host sets, table-wide — not per player. It's
  skimmed off the table for hosting — it is **not** a player's win/loss, and it is
  **not** distributed as a player-to-player settlement transfer. The host already has
  it as physical cash taken off the table.
  - **[decision] Rake is editable by the host at any point before the game closes**,
    same as cash-outs, and locks on close. Editing rake after close is not allowed —
    it would silently change historical hosting stats.
- A player's **net** (for settlement purposes) = their cash-out − their buy-ins. Rake
  never touches this number.
- **Mid-game**, `buy-ins − cash-outs` being positive is normal — that's money still in
  play, not an error. The only real error is `cash-outs + rake` exceeding total
  buy-ins (paying out more than ever came in).
  - **[decision] Overpay handling:** entering a cash-out that would push
    `cash-outs + rake` over total buy-ins is **not blocked**, but shows an immediate,
    hard-to-miss warning banner naming the exact overage amount, both at entry time
    and persistently on the Live Game screen until resolved. It isn't blocked outright
    because the host may legitimately need to record a correction to an earlier
    buy-in or cash-out and the numbers may cross temporarily. It must never be
    silently allowed to pass unflagged.
- **Settlement transfers** (who pays whom) are computed purely from each player's net
  via debt-simplification (biggest winner matched against biggest loser, etc.). Rake
  never appears as a transfer line.
  - **[decision] Deterministic tie-break:** when two or more players have equal net
    (or equal remaining net mid-simplification), ties are broken by ascending
    `player_id`. This guarantees the same inputs always produce the same transfer
    list, which matters for testing and for players double-checking math across
    sessions.

## Game lifecycle

*(New section — the original doc described in-game mechanics but never stated when a
game is "done," which the settlement graph and dashboard stats both depend on.)*

- A game has a status: **`live`** or **`closed`**.
- **[decision] Closing is an explicit host action** ("Close Game"), not inferred from
  every player having a cash-out — a host may want to review the settlement graph
  before formally closing, and some players may never cash out (walked away, house
  absorbs it) which shouldn't silently block closing forever.
- Closing a game is only allowed once the overpay check (above) passes — the host
  can't close a game that's currently in an invalid state.
- On close: all buy-ins, cash-outs, and rake for that game lock permanently. The
  settlement graph is computed once and stored, not recomputed live afterward — so a
  closed game's history can't drift even if underlying logic changes later.
- Dashboard stats (Host tab totals, Player tab net-trend) only include **closed**
  games. A live game in progress doesn't yet count toward historical stats or
  averages, to avoid a half-finished game skewing "average pot" or a trend line.

## Roles inside a game

- The **host** of a game sees everything: every player's buy-ins/cash-outs, the full
  settlement graph, total rake.
- A **player who is not the host** of a game sees only their own buy-in/cash-out/net
  for that game — never anyone else's numbers.
- A host is also a player in their own game (their own buy-ins/cash-out work exactly
  like any other player's).
- **[decision] Removing a player before any buy-in is recorded** is allowed (fixes
  accidental adds); once a player has any buy-in recorded, they can't be removed —
  only handled through the normal cash-out/settlement flow, since removal at that
  point would break the rake/settlement invariant.
- **Co-hosting is out of scope.** A game has exactly one host. Not a silent gap —
  explicitly not building this yet.

## Dashboard / history

- There is **no separate History screen**. The Home dashboard covers it via two tabs:
  - **Host tab**: games this account has hosted, hosting stats (games hosted, players
    hosted, rake collected, average pot).
    - **[decision] Definitions:** *players hosted* = total player-slots across all
      hosted games, not deduped by phone (a regular in 10 games counts 10 times —
      this is a hosting-volume stat, not a unique-people stat). *Average pot* = mean
      of `sum(buy-ins)` per game, i.e. money that came into play, not including rake
      and not counting cash-outs.
  - **Player tab**: this account's own results across every game they've played in
    (hosted or not), overall net, win count, and a net-trend chart. Only reflects
    games where this account's player row is `claimed` (see identity linking above).
- The **net-trend chart splits by stake** (the game-level buy-in amount defined
  above) — different stakes aren't comparable on one line, so each distinct stake
  gets its own chart rather than being blended into one misleading combined trend.
- Tapping any game (from either tab) goes to game detail, which applies the
  host/player visibility rule above.

## Invites (partially stubbed — see gaps below)

- **[decision] No RSVP flow.** Players are not invited-then-confirmed — a host simply
  adds them, either at game creation or mid-game via "Add late player." There is no
  In/Out/Maybe response step and none is planned; a player being added to a game *is*
  them being in the game.
- After creating a game, the host gets a "copy WhatsApp invite" action that generates
  a formatted text block (game name, location, time, invited player list) for pasting
  into a group chat — this is a courtesy notification, not a confirmation request.

## Known gaps — intentionally deferred, not silently missing

- **Invite-only enforcement**: the WhatsApp invite link is not yet a real, routable,
  verified per-player link. Anyone with the link could theoretically open the game
  right now. Real enforcement needs either phone-OTP-per-player or a signed invite
  token scheme — not built yet.
- **Contacts picker**: the "Contacts" tab on Create Game is a UI placeholder, no real
  device contacts integration.
- **Bank-check / cash-out-share actions**: these exist as clipboard-copy or toast
  stubs on the Live Game screen — no real push notification backend.
- **Phone OTP auth**: configured (Twilio Verify credentials are set) but blocked by
  Twilio trial-account number-verification limits. Currently using email magic-link
  instead.
- **Phone number reuse**: if a phone number is reassigned to a different real person
  over time, the claim-by-phone flow (above) could attach a stranger's past games to
  a new account. No detection/resolution built for this yet.
- **No live database on game screens**: game screens (buy-ins, cash-out, settlement)
  currently run on local React state only, not wired to Supabase — meaning there is
  currently **no server-side access control (RLS)** actually enforcing the
  host/player visibility rules described above. Names and phone numbers are real PII
  even in a play-money app; this should be closed before any real usage, not treated
  as cosmetic.

## Theme

"Casino felt" — deep emerald-green-black surfaces, warm gold as the primary accent
(replacing an earlier indigo-on-zinc palette). Win/loss stay emerald/red, kept
visually distinct from the green background. Tokens live in `src/index.css` under an
`@theme` block (`--color-felt-bg`, `--color-felt-surface`, `--color-felt-surface-2`,
`--color-felt-border`, `--color-gold`, `--color-gold-light`, `--color-gold-dark`).

## Stack

- React + Vite + Tailwind v4 (CSS-first config, no `tailwind.config.js`)
- Supabase: Postgres + Auth + RLS (schema in `supabase/schema.sql`) — **note: the game
  screens are currently still on local React state, not wired to live Supabase data.**
  Only auth/profiles/admin-approval actually hit the database right now. See "No live
  database on game screens" under Known gaps.
- PWA via `vite-plugin-pwa`
- Deployed on Vercel, repo at `github.com/LaksUX/Stradde-Pro`
