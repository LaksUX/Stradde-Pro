# Poker Night — Requirements

This is the source of truth for what the app does and why. Edit this file when a
requirement changes — the page-level prompts in `PAGE_PROMPTS.md` should be kept in
sync with whatever's decided here.

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

## Money model

- **1 bank = 10,000** internal units. All UI amounts are expressed in banks, never in
  a currency symbol.
- Every player starts a game with **exactly 1 buy-in** automatically — there's no
  "buy-in amount per player" decision at game creation.
- Display amounts as **whole banks, no decimals** (e.g. "12 banks", not "12.4"). Only
  the display layer rounds — all stored/calculated amounts stay full-precision.
- Buy-ins **lock 1 minute** after being entered — a host can't accidentally undo a
  buy-in a player already paid in. The slider used to add buy-ins can never be dragged
  below the already-locked count.
- Once a player's cash-out is being entered, their buy-ins are **locked** — no more
  buy-ins for that player while cashing out.

### The rake/settlement invariant

This is the one formula everything else depends on — get it wrong and every payout is
wrong:

```
sum(all players' buy-ins) = sum(all players' cash-outs) + rake
```

- **Rake** is a single fixed amount the host sets. It's skimmed off the table for
  hosting — it is **not** a player's win/loss, and it is **not** distributed as a
  player-to-player settlement transfer. The host already has it as physical cash taken
  off the table.
- A player's **net** (for settlement purposes) = their cash-out − their buy-ins. Rake
  never touches this number.
- **Mid-game**, `buy-ins − cash-outs` being positive is normal — that's money still in
  play, not an error. The only real error is `cash-outs + rake` exceeding total
  buy-ins (paying out more than ever came in) — that should be flagged clearly, not
  silently allowed.
- **Settlement transfers** (who pays whom) are computed purely from each player's net
  via debt-simplification (biggest winner matched against biggest loser, etc.). Rake
  never appears as a transfer line.

## Roles inside a game

- The **host** of a game sees everything: every player's buy-ins/cash-outs, the full
  settlement graph, total rake.
- A **player who is not the host** of a game sees only their own buy-in/cash-out/net
  for that game — never anyone else's numbers.
- A host is also a player in their own game (their own buy-ins/cash-out work exactly
  like any other player's).

## Dashboard / history

- There is **no separate History screen**. The Home dashboard covers it via two tabs:
  - **Host tab**: games this account has hosted, hosting stats (games hosted, players
    hosted, rake collected, average pot).
  - **Player tab**: this account's own results across every game they've played in
    (hosted or not), overall net, win count, and a net-trend chart.
- The **net-trend chart splits by stake** (buy-in amount) — different stakes aren't
  comparable on one line, so each distinct stake gets its own chart rather than being
  blended into one misleading combined trend.
- Tapping any game (from either tab) goes to game detail, which applies the
  host/player visibility rule above.

## Invites (partially stubbed — see gaps below)

- After creating a game, the host gets a "copy WhatsApp invite" action that generates
  a formatted text block (game name, location, time, invited player list) for pasting
  into a group chat.

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
  Only auth/profiles/admin-approval actually hit the database right now.
- PWA via `vite-plugin-pwa`
- Deployed on Vercel, repo at `github.com/LaksUX/Stradde-Pro`
