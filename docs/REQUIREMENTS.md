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

## Interaction principles

These apply to every screen, not just the ones that happen to mention them —
treat them as defaults, not per-screen decisions to re-litigate.

- **[decision] Genuinely responsive, not just a centered mobile column.** Every
  screen must adapt to the actual viewport it's rendered in — phone, tablet, or a
  wide desktop browser tab — not just cap at a fixed mobile width with dead space
  on either side. Below ~640px: the current single-column mobile-app layout.
  Above that: the content column widens proportionally (more breathing room,
  slightly larger type) rather than staying pinned to a phone-sized box in the
  middle of a desktop window. This is a main interaction detail, checked on every
  screen, not a one-off bug to fix in one place.
- **[decision] No deep links to external apps (WhatsApp, SMS, etc.).** Any
  "share" action generates text and offers **copy to clipboard only** — never a
  `wa.me/`-style deep link or app-switch. Deep links are unreliable across
  devices/browsers and require permissions this app shouldn't need; a copy button
  works identically everywhere and the host pastes it wherever they actually want
  to send it.

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

- **1 bank = 10,000 internal units — fixed, never change this scale.** Every
  buy-in is always exactly 1 bank; there is no host-set stake/buy-in-amount field.
  This reverses an earlier revision of this doc that introduced a game-level
  "buy-in amount" field (e.g. "2 banks per buy-in") — that field has been removed.
  It's worth stating plainly since this exact scale got it wrong twice during
  development (a leftover `×10` conversion from an even older draft, and later an
  internal-storage constant of 1,000 instead of 10,000) — both are fixed now, and
  this line is the permanent reference for what "correct" means.
- **[decision, supersedes the original "exactly 1 buy-in" rule] A host can choose
  each player's starting buy-in COUNT at game creation** — 1 by default, adjustable
  per player via a stepper on their chip. This does not touch the fixed-scale
  invariant above: a starting buy-in of "3" is recorded as three separate 1-bank
  buy-in events (same as three rebuys entered live), not a single 3-bank unit — so
  every downstream calculation that already treats buy-ins as a list of discrete
  1-bank events (locking, totals, the live buy-in slider) needed no changes.
  Real home games often don't start everyone at the same stack, so this closes a
  gap flagged after comparing against a competitor (HG Poker) that supports it —
  it was a deliberate simplification originally, not an oversight, but flexibility
  here matters more than the uniformity did.
- Display amounts as **whole banks, no decimals** (e.g. "12 banks", not "12.4"). Only
  the display layer rounds — all stored/calculated amounts stay full-precision.
  - **[decision] Rounding rule:** each individual figure (a player's buy-ins,
    cash-out, net) is rounded independently for display. A displayed total (e.g. sum
    of all buy-ins shown on a summary) is computed from the full-precision sum and
    *then* rounded once — it is not the sum of the already-rounded per-player
    numbers. The two can legitimately disagree by ±1 bank in the UI; that's expected
    and not a bug.
- **[decision, supersedes the 60-second auto-lock rule] Buy-ins lock at a host-run
  "bank check," not on a timer.** The host periodically (roughly every couple of
  hours is the suggested cadence, not an enforced one) reconciles the table out
  loud, then confirms — every buy-in entered before that moment locks; anything
  entered after stays freely editable until the *next* bank check. Before a
  game's first bank check, nothing is locked at all, no matter how long ago a
  buy-in was entered.
  - This is a better match for how a real game actually reconciles than a
    silent per-buy-in clock nobody's watching, and it incidentally resolves the
    old "starting buy-ins lock from setup, not from first play" problem for
    free: a starting buy-in is exactly as unlocked as any other buy-in entered
    before the first bank check, because there's no clock running against it at
    all until a check happens.
  - The slider used to add/remove buy-ins can never be dragged below a player's
    already-locked count — a bank check is a floor, never a ceiling: a host can
    always add another buy-in for a player who's still in the game, no matter
    how recently a check locked their prior ones.
  - **[decision] Locked buy-ins are permanent — no override, including for
    admins.** Same trust/integrity tradeoff as before, just triggered by a
    confirmation instead of a clock: if a host spots a mistake before running
    the check, they fix it there; after the check locks it, the only remedy is a
    correcting note or handling it as cash outside the app.
  - Removing a player follows this same checkpoint — see Roles inside a game
    below for the full rule and its history.
- **[decision] No currency value per bank — banks stay abstract, permanently.**
  A display-only "1 bank = ₹500" multiplier was considered (it would have made shared
  settlement text directly actionable) and **rejected**. A game-level money field has
  already been introduced and torn out twice, each time leaking into the math and
  producing wrong payouts; the safest version of that field is the one that doesn't
  exist. Hosts and players already know what a bank is worth at their own table.
  Treat this as settled, not as an open question to revisit each time sharing comes
  up — if the conversion ever does return, it must live strictly in the presentation
  layer and never reach a stored or calculated value.
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

*(Revised — the game now moves through four explicit steps rather than one
undifferentiated "live" screen. This replaces the earlier model where buy-in entry,
cash-out entry, and settlement editing all happened in the same screen at the same
time.)*

- **[decision] A game has a status of `live`, `cashout`, or `closed`**, and moves
  through four host-facing steps, each ended by an explicit host action — nothing
  advances automatically:
  1. **Setup.** The host fills in game details and adds players (from their phone's
     roster or fresh), then shares an invite link. Produces a game with
     `status: "live"`. See Invites below for the link itself.
  2. **Buy-ins** (`status: "live"`). The host tracks buy-ins as the game runs, can
     add, edit, or remove players, and can bank-check the table periodically (see
     below). A player who leaves early can be cashed out right here without
     affecting anyone else's game. The host ends this step explicitly ("End
     Buy-ins") once buy-in collection for the night is done — this does **not**
     require the books to balance, since most players haven't cashed out yet.
     Ending buy-ins is freely reversible (a "back to buy-ins" action from step 3)
     since nothing here has been finally locked.
  3. **Cash-outs** (`status: "cashout"`). Buy-ins are now frozen for the game; the
     host sees every player as a plain list and enters each one's cash-out from a
     dedicated bottom sheet. The same balance/overpay calculation from step 2
     applies here, unchanged. The host ends this step ("Review & Continue") once
     every player who's cashing out has been entered — this **does** require the
     books to balance (see below), since this is the last point before settlement
     is computed.
  4. **Settlement** (`status: "cashout"` until the final close). The computed
     settlement (debt-simplified transfers) is shown and is host-editable —
     transfers can be corrected or added by hand, using the same bottom-sheet +
     keypad pattern as cash-out entry, deliberately, so the host isn't learning a
     second interaction pattern for materially the same kind of action ("how much,
     from whom, to whom"). The host's final action here ("End Game & Send
     Results") is what actually sets `status: "closed"` and locks everything — see
     Results link below for what "send results" means.
- **[decision] A player who leaves early is cashed out inside step 2, not by
  ending the buy-in phase for everyone.** The host opens that one player's sheet
  and enters their cash-out there and then; the rest of the table keeps taking
  buy-ins normally. That player then shows up dimmed/settled in the step 2 list
  the same way a closed game's players do, and their cash-out carries forward
  into step 3 unchanged — step 3 only needs entries for whoever's left.
- **[decision] Steps 2 and 3 are reversible; only the step-4 close is not.**
  Nothing about ending buy-ins or ending cash-out entry destroys or finally locks
  data — a host can step back from cash-out entry to buy-ins if they ended that
  phase too early. The permanent lock (see below) only happens at the true final
  close in step 4, same as before.
- **[decision] Closing (the step-4 action) is an explicit host action**, not
  inferred from every player having a cash-out — some players may never cash out
  (walked away) which shouldn't block closing forever.
- Closing a game is only allowed once the overpay check (above) passes — the host
  can't close a game that's currently in an invalid state. The same check gates
  ending step 3, for the same reason: by the time cash-out entry is done, the books
  should already balance.
- **[decision, already built but previously unwritten] The books must balance exactly
  to close.** The close dialog requires `sum(buy-ins) = sum(cash-outs) + rake` within
  tolerance — not just "not overpaid." Underpay (money that came in and was never
  accounted for) is normal mid-game but is an error at close, and this was enforced in
  code without ever being stated here.
- **[decision] A player who never cashed out is resolved explicitly at close, by the
  host.** The doc used to say the house "absorbs it" while the code silently treated a
  missing cash-out as a cash-out of zero — meaning that player's whole stack was
  quietly won by everyone else. Neither the silence nor the guess is acceptable when
  it moves real money. At close, any unaccounted amount must be named on screen and
  the host must choose where it goes: **added to rake**, or **split across the
  remaining players**. No default, no inference — the host is the only one who knows
  what actually happened at the table.
- **[decision, not yet built] A closed game can be reopened by its host within 30
  minutes of closing.** Close is currently irreversible and locks everything
  permanently, so a single mistap produces a permanently wrong ledger with no remedy
  short of settling outside the app. A short, host-only reopen window covers the real
  case (spotting a bad number seconds later) without weakening the integrity
  guarantee that makes locking meaningful. After the window, the game is final.
  Reopening recomputes and re-stores the settlement on the next close.
  - Reopening invalidates the "settlement is computed once and never recomputed"
    assumption that paid/pending flags rely on — see Settlements ledger below.
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
  - **[decision, correcting an overstatement] Settlement lines are the one exception,
    and they aren't really an exception.** A player must see their own settlement
    lines, and a transfer inherently names its counterparty ("you owe Arjun 3 banks"),
    which does reveal that Arjun came out ahead. The rule as originally written was
    already contradicted by the My Settlements feature. Stated correctly: a non-host
    player sees their own buy-ins, cash-out and net, plus the settlement lines they
    are personally a party to — and never any other player's buy-ins, cash-out, or
    net figures.
- A host is also a player in their own game (their own buy-ins/cash-out work exactly
  like any other player's).
- **[decision, replacing a rule that was never reachable] A player can be removed
  while all of their buy-ins are still unlocked.** The previous rule — "removable
  until any buy-in is recorded" — could never fire in practice: every player is
  seeded with at least one buy-in the instant they're added, at creation *and* via
  "Add late player," so the removal control was dead code and an accidental add was
  uncorrectable. Tying removal to the buy-in lock instead makes it work the way it
  was always meant to, and reuses a rule already in the model rather than inventing
  a second one — this held when the lock was a 60-second timer and holds unchanged
  now that the lock is a bank check (see Money model): a player is removable exactly
  as long as none of their buy-ins have been locked by one yet. Once any of a
  player's buy-ins has locked, they can only be handled through the normal
  cash-out/settlement flow — removing them at that point would break the
  rake/settlement invariant.
- **[decision, not yet built] The host can edit a player's name or phone number at
  any point before the game closes.** This is a record correction (a typo, a wrong
  digit), not a money action, so it isn't gated by the buy-in lock the way removal
  is — a player's locked buy-ins don't need to stay attached to a misspelled name.
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
- **[vestigial]** The net-trend chart still has by-stake grouping logic in code
  (a holdover from when buy-in amount was a variable game-level field) — with the
  stake field removed, every game is always the same "stake" now, so this always
  collapses to a single chart in practice. Harmless to leave as-is; not worth
  ripping out for its own sake, but don't treat "split by stake" as a live
  requirement to preserve if it's ever in the way of something else.
- Tapping any game (from either tab) goes to game detail, which applies the
  host/player visibility rule above.

## Settlements ledger

There was no way to see settlement obligations *across* games — only one game at a
time, from inside that game's own Settlement/Game Detail screens. This closes that
gap by living **directly inside Home's existing Player/Hosting tabs** — not a
separate screen reached through an icon or extra navigation step. It's part of what
those tabs already are, the same way stats and recent games are.

- **Player tab** gets a "My Settlements" section: every settlement line across every
  closed game this account was a party to (from or to), regardless of who hosted it —
  who they owe, who owes them, how much, from which game. This is the cross-game
  answer to "what do I actually owe right now" that no single game's detail screen
  can give on its own.
- **Hosting tab** gets a "Settlement Ledger" section: every settlement transfer
  across every game *this account hosted* (not games they merely played in) — the
  full picture, not filtered to their own transfers. A tap-to-filter player chip
  drills into one person's transfers across all of the host's games (e.g. "how much
  has Arjun owed/been owed across every game I've run").
- **[decision] Source of truth**: only `closed` games contribute — settlement is
  computed once at close and stored (per Game lifecycle above), so this ledger reads
  that stored data rather than recomputing anything live. A live game's in-progress
  numbers don't appear here.
- **[decision] Settlement summary sharing is one combined message, not per-player.**
  "Copy settlement summary" (Settlement screen) generates a single text block with
  every transfer in that game — there's no per-player individual message today. If a
  host wants to notify just one player, they currently have to manually pick out
  their line and copy/paste it separately, or use the Settlements Ledger drill-down
  above to see one player's numbers on-screen. A dedicated "copy for this player
  only" action is a reasonable future addition but isn't built.
- **[decision] Every settlement line has a Paid/Pending status, toggleable by
  whoever's currently signed in.** Without this, the ledger only ever grows —
  every closed game adds more transfer lines forever, with no way to reflect that a
  debt was actually settled in real life. A tap on a line (Settlement Ledger,
  My Settlements, or a closed game's own Payments list — all three read/write the
  same underlying flag) flips it between paid and pending; paid lines stay in the
  list (dimmed, struck through) rather than disappearing, so the ledger still reads
  as a full history, not just an inbox of what's outstanding.
  - **[decision] Single-sided toggle, not a two-party mark/confirm flow.** The
    sibling Straddle project models this as the payer marking "I paid" and the
    payee separately confirming receipt — more trustworthy, but it needs two
    distinct logged-in accounts to mean anything. Players here don't have real
    accounts yet (see Known gaps), so for now whoever's signed in (today, always
    the host) can flip either side's status directly. Revisit the two-step version
    once player accounts exist.
  - **[decision, superseding the previous separate-store approach] The paid flag
    lives on the transfer itself and is persisted with its game.** It used to be
    kept in its own `localStorage` map keyed by game id + the transfer's index,
    because games weren't persisted at all and a full game cache would have shadowed
    the demo seed data. Now that games persist properly (see Persistence below),
    a second store for one fact is just two things to keep in step — which is how
    they drift. The old store is retained only to migrate existing flags once, and
    nothing writes to it any more.
  - **[decision, built 2026-09-07] Settlement transfers need stable ids before
    any reopen/edit path ships.** Addressing a transfer by its index in the
    settlement array is safe only while a closed game's settlement is
    immutable. The moment a game can be reopened and re-settled (see Game
    lifecycle), indices shift and a paid flag silently lands on the wrong line
    — the worst class of bug this app can have, because it's wrong about money
    and gives no sign of it. The `settlements` table has a real `id uuid` (not
    an array index), and `App.jsx` now writes settlements there and addresses
    every toggle/paid-status action by that id — no risk left here.
  - **[decision, built 2026-09-07] Record who marked a line paid and when.**
    Even single-sided, `paid_at` and `paid_by` cost nothing now and are what
    make the eventual two-party mark/confirm flow a data migration rather than
    a redesign. A ledger that says a debt was settled but not who said so is
    hard to trust the moment two people disagree. `settlements.paid_by` exists
    in the schema and `gamesApi.setSettlementPaid` now records the signed-in
    account id on every toggle.

## Invites (partially stubbed — see gaps below)

- **[decision] No RSVP flow.** Players are not invited-then-confirmed — a host simply
  adds them, either at game creation or mid-game via "Add late player." There is no
  In/Out/Maybe response step and none is planned; a player being added to a game *is*
  them being in the game.
- After creating a game, the host gets a "copy WhatsApp invite" action that generates
  a formatted text block (game name, location, time, invited player list) for pasting
  into a group chat — this is a courtesy notification, not a confirmation request.
  Copy-to-clipboard only, per the no-deep-links interaction principle above.
- **[decision] Closing a game (step 4) also generates a results link, so each
  player can see their own data and settlement** — the same copy-to-clipboard
  pattern as the invite link, appended to the settlement summary text rather than
  a separate action, since "end the game" and "send results" are one moment for
  the host.
  - **[decision] Opening the results link requires signing in with a claimed
    account**, not an open unauthenticated link. This matches the existing rule
    that a player only ever sees their own numbers (see Roles inside a game): a
    signed-out visitor with the link sees nothing, and a signed-in visitor sees
    only the rows their claimed player identity is actually a party to.
  - **[decision, still a stub in the app] The results link is a stub, like the
    invite link, and was blocked for a more fundamental reason than "not wired
    up yet."** Game data used to live in each host's own browser storage (see
    Persistence above) — there was no shared backend a second device could
    query, so a real per-game results link couldn't resolve to anything for
    anyone but the host's own browser no matter how much link-generation code
    got written. That blocker is now gone: `games`/`game_players`/`settlements`
    are real Supabase tables with RLS enforcing exactly "a signed-in, claimed
    player sees their own rows and nothing else" (`MOBILE_MIGRATION_PLAN.md`
    Phase 1), and as of 2026-09-07 `App.jsx` itself reads and writes those
    tables instead of local state for every game screen — so a second device
    querying the same game id would now actually see correct, live data. A
    results link can just be a normal in-app URL (`/game/:id`), no separate
    token/sharing scheme needed, since RLS already does the gating a public
    link would otherwise have to reinvent. What's still missing is purely the
    UI: no route/screen exists yet that resolves `/game/:id` for a
    non-host visitor and no "send results" action generates that link — that's
    the pending follow-up, not a new open question.

## Roster (known players)

- **[decision] A host's added players are always remembered** — name and phone,
  reusable on every future game without retyping. This is the "Your players" list
  on Create Game, and the same list should be offered first when adding a player
  mid-game too (see Live Game below) — one roster, used everywhere a player gets
  added, not a Create-Game-only convenience.
- **[decision, superseded 2026-09-08] `localStorage` used to be where this
  lived; it's `known_players` in Supabase now.** The original reasoning no
  longer applies — it was a stopgap because game screens were still local
  React state with nowhere server-side to durably store a roster either.
  Now that both are wired to Supabase (see Persistence below and
  `MOBILE_MIGRATION_PLAN.md` Phase 1), the roster is cross-device and
  per-account instead of per-browser, the same as games. Existing
  `localStorage` roster data from before this change was not migrated — it's
  simply abandoned; hosts see an empty "Your players" list once and it
  repopulates from there via `known_players`.
- Adding a player (anywhere — Create Game or mid-game) should default to picking
  from this roster; free-text entry (with mandatory phone number) stays available
  for someone genuinely new, and doing so adds them to the roster for next time.

## Persistence and data durability

*(Originally written when this was the single most serious problem in the app and
localStorage was the fix. Superseded 2026-09-07 by the Supabase wiring
(`MOBILE_MIGRATION_PLAN.md` Phase 1) — kept below for the history, since the
underlying durability requirement it was solving for hasn't changed, only the
mechanism.)*

- **[decision, superseded] `src/lib/gameStore.js` (localStorage, scoped per
  account id) is no longer what persists games.** It used to be: before that,
  `activeGame` and `pastGames` were plain React state with no persistence at
  all, so a refresh during a game destroyed it outright. `gameStore.js` fixed
  that with per-account `localStorage`, but that only ever bought durability
  on one device/browser, never sync. As of this wiring pass, `App.jsx` reads
  and writes games directly through `src/lib/gamesApi.js` to Supabase —
  durability, multi-device access, and the account-scoping RLS already
  enforces (see RLS policies, `MOBILE_MIGRATION_PLAN.md` Phase 1) all come
  from the database now, not from a browser store. `gameStore.js` is dead code
  at this point; nothing in `App.jsx` still calls it.
- **A failed write is surfaced, not swallowed.** Every `gamesApi` call that
  `App.jsx` awaits is wrapped so a thrown error shows a toast naming what
  failed, rather than failing silently — same principle the old localStorage
  layer had ("a failed save is surfaced"), now applied to network writes
  instead.
- **[decision, built] The undo stack was removed entirely, not just left
  unpersisted.** The original decision here was narrower — "don't persist
  undo across a reload" — back when actions only touched local React state and
  a reload could plausibly still have something to un-add. Now every mutation
  is already a persisted Supabase write the instant it happens; there is no
  local-only state left for an "undo" to rewind, and a client-side undo that
  can't actually reverse a database write would be misleading. A mistaken
  action now needs a real correction (edit/remove, same as any other fix),
  not an undo button.
- **[decision, built 2026-09-07] Dates and times are now stored as real
  timestamps.** They used to be locale-formatted display strings
  (`"7 Sep"`, `"9:40 PM"`), which broke sorting and any timezone-aware stat.
  The Supabase tables store real `timestamptz` columns (`games.started_at`,
  `buyins.created_at`, etc.); `gamesApi.js` derives the display strings
  (`fmtDateDisplay`/`fmtTimeDisplay`) at read time instead of storing them.
  One related, deliberate behavior change: Create Game's date/time fields are
  now preview-only — the persisted game's `started_at` is always the server's
  `now()` at creation, not whatever the host had typed in the form.

## Monetization

*(New section. The doc previously had none, and several existing decisions quietly
foreclosed the obvious paths — worth stating the model so those tradeoffs are made
deliberately rather than by accident.)*

- **[decision] Hosts pay; players are free forever.** The host carries the pain
  (tracking the table, chasing money afterwards), holds the money, and in many games
  takes rake — a host taking rake is effectively running a small business. Players
  are the acquisition loop, not the revenue: every game a host runs introduces the
  app to roughly half a dozen people. Usefully, the existing super-admin host-approval
  gate and a billing gate are the same gate.
- **[decision] The wedge is settlement chasing, not game tracking.** Tracking buy-ins
  is a commodity — a note in a group chat does it. "Who still owes me, across five
  months of games" is the thing nobody can do on their own, and it's where the
  Settlements Ledger and Paid/Pending already point. Cross-game netting (A owes B from
  one game, B owes A from another — real people net these), reminders, and per-player
  messages are the paid bundle.
- **[decision] Model is a host subscription, annual-first.** Home games pause for
  months at a time, which churns monthly plans hard; an annual plan matches how the
  activity actually behaves. Price should be anchored against rake — one hand's rake
  covering a year is the natural pitch — and set for the Indian market rather than
  copied from US consumer app pricing.
- **[decision] Free tier is limited by history and reach, never by correctness.**
  Indicative line: free = one active game, a short window of closed-game history, one
  device, manual copy-to-clipboard sharing. Paid = unlimited history, cross-device
  sync (which is the Supabase work that has to happen regardless), settlement
  reminders, cross-game netting, per-player messages, season/league standings, and
  export.
- **[decision] Never monetize the money math.** Settlement accuracy, the ledger, and
  the integrity guarantees (locking, the balance check) are never gated, degraded, or
  advertised against. Trust is the entire product; a paywall in front of a correct
  number destroys more than it earns. No ads anywhere near someone's debts.
- **[decision] Give players a reason to sign in.** Claim-by-phone is designed but
  nothing currently pulls a player through it — they never need an account. Seeing
  their own history and their own outstanding debts is the free hook, and it's also
  what turns each game into six potential future hosts.
- **Two existing decisions block this and are now explicitly limitations rather than
  principles:**
  - The **no-deep-links, copy-to-clipboard-only** rule kills both the reminder loop
    (the core of the paid product) and the viral loop. It remains the right default;
    it is not a permanent constraint, and real delivery is required for a paid tier.
  - **Super-admin approval of every host** cannot coexist with self-serve payment at
    any scale. Approval needs to become automatic with abuse controls, or become the
    paid gate itself.
- **[decision, not yet built] Instrument before pricing.** There are currently no
  analytics requirements at all, and the free/paid line is guesswork without them. At
  minimum: games created vs. closed, players per game, closes with unresolved
  cash-outs, settlement lines actually marked paid, and host retention week over week.
- **Positioning is a real asset and should stay explicit: this is a ledger, not a
  wallet.** No money moves through the app and no payments are processed. Given how
  Indian real-money-gaming regulation is moving, that stance is load-bearing rather
  than incidental — it should survive contact with monetization, and it is why the
  natural app-store category is Finance rather than Games.

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
- **No live database on game screens [closed 2026-09-07]**: game screens
  (buy-ins, cash-out, settlement) used to be wired to local state plus local
  persistence, not Supabase. As of `MOBILE_MIGRATION_PLAN.md` Phase 1, the
  `games`/`game_players`/`buyins`/`bank_checks`/`settlements` tables, their RLS
  policies enforcing the host/player visibility rules above, and an async data
  layer (`src/lib/gamesApi.js`) that mirrors the local shapes all exist, and
  `App.jsx` now calls that layer directly for every mutation on every game
  screen (create game, add/edit/remove player, buy-ins, bank check, cash-out,
  end-buyins/back-to-buyins/close, settlement writes, paid/pending toggle) —
  local React state is now just a cache of what Supabase returns, refetched
  after every write. Two deliberate behavior changes came with this: the local
  undo stack was removed (there's no local-only state left to "undo" against —
  every action is already a persisted write, and a wrong one needs a real
  correction, not a client-side rewind), and Create Game's date/time fields are
  now preview-only display — the persisted game always uses the server's
  `now()` as `started_at`. The RLS access-control proof
  (`scripts/test-rls-isolation.mjs`) has been run against the live project
  (two real signed-in accounts, 2026-09-08) and passed — see
  `MOBILE_MIGRATION_PLAN.md` Phase 1.
- **[closed 2026-09-08] Roster is now account-scoped**: games and the roster
  are both stored in and read from Supabase now. `known_players` gained a
  `phone` column, `src/lib/knownPlayersApi.js` has the async read/write
  functions, and `roster.js`'s call sites (`CreateGameScreen`, "Add late
  player") now call those instead of `localStorage` — see
  `MOBILE_MIGRATION_PLAN.md` Phase 1. This closes out Phase 1 entirely; no
  game or roster data is read from or written to `localStorage` anywhere in
  the app any more.
- **No PII deletion or export path**: the app stores real names and phone numbers
  with no retention policy and no way for a player to be removed or to get their
  data out. Tolerable in a private test; a legal requirement the moment money
  changes hands for the product.
- **Rounding can disagree by ±1 bank in the UI** (see Money model). Accepted
  everywhere except the settlement view, which is the one screen where cash actually
  changes hands and where a screenshotted discrepancy becomes a support problem —
  exact values should be shown there.
- **Late-joining players can't be given a starting buy-in count**, unlike players
  added at game creation. Minor, but the kind of asymmetry that reads as a bug.

## Theme

"Casino felt" — deep emerald-green-black surfaces, warm gold as the primary accent
(replacing an earlier indigo-on-zinc palette). Win/loss stay emerald/red, kept
visually distinct from the green background. Tokens live in `src/index.css` under an
`@theme` block (`--color-felt-bg`, `--color-felt-surface`, `--color-felt-surface-2`,
`--color-felt-border`, `--color-gold`, `--color-gold-light`, `--color-gold-dark`).

## Stack

- React + Vite + Tailwind v4 (CSS-first config, no `tailwind.config.js`)
- Supabase: Postgres + Auth + RLS (schema in `supabase/schema.sql`, migration for the
  existing project in `supabase/migrations/20260907_phase1_game_data_and_rls.sql`,
  applied to the live project 2026-09-07, RLS isolation proof passing as of
  2026-09-08) — game screens (buy-ins, cash-out, settlement, everything in
  `LiveGameScreen`/`CashoutEntryScreen`/`SettlementScreen`) are wired to live
  Supabase data via `src/lib/gamesApi.js`, and the roster via
  `src/lib/knownPlayersApi.js`, both refetching after every write rather than
  using realtime subscriptions (a deliberate v1 choice, see
  `MOBILE_MIGRATION_PLAN.md`). No game or roster data is read from or written
  to `localStorage` anywhere in the app any more.
- PWA via `vite-plugin-pwa`
- Deployed on Vercel, repo at `github.com/LaksUX/Stradde-Pro`
