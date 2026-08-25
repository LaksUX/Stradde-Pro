# Poker Night — Page-Level Prompts

One section per screen. Each is written as a self-contained spec you can hand back to
Claude when asking for a change — "update the Live Game section below, then implement
it" is enough context for a correct edit, without re-explaining the whole app.

Keep these in sync with reality: when a screen changes, update its section here in the
same request. If `REQUIREMENTS.md` and a page prompt ever disagree, `REQUIREMENTS.md`
wins — page prompts are the "how," requirements are the "what and why."

---

## Login

Email magic-link. Enter email → "Send magic link" → "check your email" confirmation
state with a way to go back and use a different email. Casino-felt dark theme, centered
card, ♠ mark. (Swap target: phone OTP via Twilio Verify, once unblocked — see
`REQUIREMENTS.md` auth section.)

## Pending Approval

Shown to any signed-in account that isn't an approved host or admin. States plainly
that their account exists and they need an admin to approve them as a host. Includes
logout.

## Admin (hidden, admin-only)

Lists every non-admin profile with name/phone, current role/approved status. Per-row
"Approve as host" / "Revoke approval" actions, writing directly to `profiles.role` /
`profiles.approved`. Reachable only for `role === "admin"` accounts, via a small entry
point on Home.

## Home

Header: greeting + name, admin-only entry point to Admin screen, logout.

Below that: Live Game card if one's active, "New Game" CTA, then a **Host / Player**
segmented toggle:

- **Host tab**: hosting-stats grid (games hosted, players hosted, rake collected, avg
  pot/game) + list of recently hosted games.
- **Player tab**: overall net + win count summary card, then the **net-trend chart
  split by stake** (one chart per distinct buy-in amount, never blended), then a list
  of games played with personal net per game.

Tapping any game in either list goes to Game Detail.

No separate History screen/tab — this covers it.

## Create Game

- Game name and location **autofill from the most recent past game** (still editable).
- No per-player buy-in count control — every added player gets exactly 1 buy-in,
  automatically.
- Player entry: segmented tabs **Your players / Contacts / Type in**.
  - "Your players" = remembered roster (name + phone), tap to add.
  - "Contacts" = placeholder stub (no real device integration yet).
  - "Type in" = free text, **requires both name and phone** before a player can be
    added — phone is mandatory, not optional.
  - Selected players stay visible as removable chips (✕) regardless of active tab,
    each chip showing name + phone.
- "Start Game" is **disabled until at least 1 player is added** (and a game name is
  set). This isn't cosmetic — a 0-player game breaks the Live Game screen's settle
  button, which only renders when players exist.
- After creating: a "copy WhatsApp invite" step generates formatted text (game name,
  location, time, invited player list, placeholder link) via
  `navigator.clipboard.writeText`. Stub — no real routing/verification yet.

## Live Game

**Player list** (not the primary interaction surface — tapping is):

- Each row: name, buy-in count shown **large and bold** (the one dynamic number that
  matters most), a small status **dot** instead of a text badge (in-play vs.
  settled-win vs. settled-loss color), tap opens the bottom sheet.
- Per-row stub actions: send a "confirm your bank" check (toast stub), share cash-out
  details for a player quitting early (clipboard-copy stub).

**Stats row**: on-table total, cashed-out total, rake (masked by default, tap to
reveal).

**Live bankroll-check strip**: shows `buy-ins = cashed-out + rake + still in play` is
holding, or flags the real error case (cash-outs + rake exceeding buy-ins) — see the
invariant in `REQUIREMENTS.md`. Money still in play mid-game is normal, not an error;
don't flag it.

**Bottom sheet** (opens per player, single sheet, no tab navigation between buy-in and
cash-out):

- **Buy-in** is primary: big number + status dot, a slider (0–30, ticks every 5) whose
  minimum floors at the player's already-locked buy-in count, a quiet "Locks in 1 min"
  caption (not a boxed warning), "Confirm N buy-ins" button.
- **Cash out this player** is a small toggle below the buy-in section — flipping it on
  **hides the buy-in slider/confirm entirely** (buy-ins lock while cashing out) and
  reveals: a small "N buy-ins · X banks in — locked while cashing out" reference line
  (buy-in figure shown **once**, not duplicated), a large "Cashing out" number, live
  net, a calculator keypad (0–9, ⌫, C), "Confirm cash out" button.

"End Game & Settle" button at the bottom, only rendered when `players.length > 0`
(consequence of the Create Game gate above — should never actually be hit empty, but
the guard stays as a safety net).

## Settlement

Computed transfers (winners paid by losers, rake excluded per the invariant) shown as
a list, each tappable to open an edit sheet: From/To as roster **chip pickers** (never
free text), amount via the same calculator keypad, Remove/Save actions. "Add custom
payment" opens the identical sheet blank. A balance-check message surfaces if buy-ins
and cash-outs don't reconcile (tolerance ~50 units for 100-unit display rounding).

## Game Detail

**Role-aware** — this is not optional, it's the core privacy rule:

- If the viewer **is** the game's host: full breakdown — pot, player count, rake
  (masked/revealable), every player's in/out/net sorted by net, the settlement log.
- If the viewer **is not** the host (just a player in someone else's game): only their
  own buy-in, cash-out, and net. Nothing about other players, no rake, no leaderboard.

## Global

- Dark casino-felt theme throughout (`src/index.css` `@theme` tokens) — no currency
  symbols anywhere, bank units only, whole numbers on display.
- Bottom nav: Home + Live (when a game's active) only — no History entry.
- `overflow-x: hidden` on `html, body` plus responsive `max-w-[430px] w-full`
  containers — don't reintroduce fixed pixel widths that could overflow on narrow
  phones.
