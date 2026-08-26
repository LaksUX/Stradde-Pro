# Poker Night — Page-Level Prompts

One section per screen. Each is written as a self-contained spec you can hand back to
Claude when asking for a change — "update the Live Game section below, then implement
it" is enough context for a correct edit, without re-explaining the whole app.

Keep these in sync with reality: when a screen changes, update its section here in the
same request. If `REQUIREMENTS.md` and a page prompt ever disagree, `REQUIREMENTS.md`
wins — page prompts are the "how," requirements are the "what and why."

> **Revision note:** Synced against the updated `REQUIREMENTS.md` (game lifecycle,
> stake field, claim-by-phone identity, edit/lock windows, deterministic settlement).
> Also switches theming to shadcn/ui and adds an **Edge cases** subsection to every
> screen that had gaps — flagged with ⚠️ where the requirement doc doesn't yet dictate
> an answer and one is proposed here for you to confirm.

---

## Theming — shadcn/ui

Component layer moves to **shadcn/ui** (Radix primitives + Tailwind v4, no separate
component library CSS to fight). This is additive to the existing token system, not a
replacement of the casino-felt palette:

- Keep the existing CSS-first `@theme` block in `src/index.css`
  (`--color-felt-bg`, `--color-felt-surface`, `--color-felt-surface-2`,
  `--color-felt-border`, `--color-gold`, `--color-gold-light`, `--color-gold-dark`,
  plus win/loss emerald/red) as the source of truth for brand color.
- Add shadcn's standard CSS variable set (`--background`, `--foreground`,
  `--card`, `--primary`, `--primary-foreground`, `--border`, `--ring`, `--radius`,
  etc. — the `slate`/`zinc` base style is fine as a starting point) and **remap those
  variables to the felt tokens** rather than leaving shadcn's defaults in place:
  - `--background` → `--color-felt-bg`
  - `--card` → `--color-felt-surface`
  - `--popover` (bottom sheets, dropdowns) → `--color-felt-surface-2`
  - `--border` / `--input` → `--color-felt-border`
  - `--primary` / `--ring` → `--color-gold`
  - `--primary-foreground` → a near-black felt tone for text on gold
  - `--destructive` → the existing loss/red token (don't introduce a second red)
- No `tailwind.config.js` — shadcn v4 install is CLI-driven (`components.json` +
  `src/index.css`), consistent with the existing Tailwind v4 CSS-first setup.
- Use shadcn primitives for the components that already imply their shape:
  `Sheet` (bottom sheets on Live Game / Settlement edit), `Toggle`/`Switch` (cash-out
  toggle), `Slider` (buy-in slider), `Dialog` (Admin approve/revoke confirmation),
  `Tabs` (Host/Player toggle, Your players/Contacts/Type in) — don't hand-roll these.
- ⚠️ **Edge case — dark-mode-only app.** shadcn ships light/dark variants by default;
  this app has no light mode (felt is always dark). Set the `dark` class permanently
  on `<html>` (or skip the light variables entirely) so a future dependency update or
  OS-level "light mode" preference can't accidentally leak a light theme in.

---

## Login

Email magic-link. Enter email → "Send magic link" → "check your email" confirmation
state with a way to go back and use a different email. Casino-felt dark theme, centered
card, ♠ mark. (Swap target: phone OTP via Twilio Verify, once unblocked — see
`REQUIREMENTS.md` auth section.)

### Edge cases
- ⚠️ **Magic link opened on a different device/browser than it was requested on**
  (e.g. link sent to phone's mail app, opened there, but the person had the tab open
  on desktop) — the desktop tab should detect the new session on refresh/focus rather
  than being stuck on "check your email" forever.
- ⚠️ **Expired or already-used link** — needs its own state, not a generic error:
  "This link has expired — send a new one," with the same email prefilled.

## Complete Profile *(new — required by the identity-linking change)*

Shown once, after first successful login, before Pending Approval / Home — only if the
signed-in account has no phone number on file yet.

- Single field: phone number, with format hint. On save, normalizes to E.164 (see
  `REQUIREMENTS.md`) and attempts the claim match: any `unclaimed` player rows with
  this phone across any game get linked to this account (`account_id` set,
  status → `claimed`).
- Framed as "so we can match you to games you've been invited to," not as a generic
  profile field — the phone number is functional, not decorative, and skipping it
  means the Player tab will stay empty even for games the person already played in.
- Skippable ("Do this later") but re-prompted on next login until filled, since
  without it the account can never claim any player row.

### Edge cases
- ⚠️ **Phone already claimed by a different account.** Two accounts entering the same
  number is a conflict, not a silent overwrite — show an error and don't reassign; a
  real resolution (support flow) is out of scope for now, but silently stealing the
  link from another account is worse than blocking.
- ⚠️ **No unclaimed rows match** — this is the common case for a brand-new player
  (nobody's added them to a game yet) and should save quietly, not treat "0 games
  linked" as an error state.

## Pending Approval

Shown to any signed-in account that isn't an approved host or admin. States plainly
that their account exists and they need an admin to approve them as a host. Includes
logout.

### Edge cases
- ⚠️ A player-only account (never wants to host) will land here if they ever hit a
  host-only route — confirm this screen's copy doesn't presume the person *wants* to
  be a host; someone who only ever plays in others' games has no reason to wait here
  and should be routed to Home instead, since Home doesn't require host approval to
  view the Player tab.

## Admin (hidden, admin-only)

Lists every non-admin profile with name/phone, current role/approved status. Per-row
"Approve as host" / "Revoke approval" actions, writing directly to `profiles.role` /
`profiles.approved`. Reachable only for `role === "admin"` accounts, via a small entry
point on Home.

### Edge cases
- ⚠️ **Revoking a host who has live (unclosed) games.** `REQUIREMENTS.md` flags this
  as an open question — until it's answered, "Revoke approval" should show a
  confirmation dialog naming any of that host's games that are still `live`, so the
  admin isn't revoking blind. Doesn't need to *block* revocation, just surface it.

## Home

Header: greeting + name, admin-only entry point to Admin screen, logout.

Below that: Live Game card if one's active, "New Game" CTA, then a **Host / Player**
segmented toggle (shadcn `Tabs`):

- **Host tab**: hosting-stats grid (games hosted, players hosted, rake collected, avg
  pot/game) + list of recently hosted games. Stats and list reflect **closed games
  only** — a game in progress doesn't count toward totals yet (see
  `REQUIREMENTS.md` → Game lifecycle).
- **Player tab**: overall net + win count summary card, then the **net-trend chart
  split by stake** (one chart per distinct buy-in amount, never blended), then a list
  of games played with personal net per game. Reflects only games where this
  account's player row is `claimed`.

Tapping any game in either list goes to Game Detail.

No separate History screen/tab — this covers it.

### Edge cases
- ⚠️ **Player tab, zero claimed games.** Distinct empty state from "no games at all"
  — if the account has an unclaimed phone number sitting in some game somewhere, the
  empty state should nudge toward Complete Profile rather than just saying "no games
  yet," since the fix might be a missing phone number rather than actually never
  having played.
- ⚠️ **A live game the viewer is hosting AND playing in** — only one Live Game card
  should show, not two; the "active game" state is per-account, not per-role.
- **Host tab, zero closed games but one live game in progress** — stats grid should
  read as genuinely zero (not loading/error), with the live game visible via its own
  card above, so the host doesn't think their in-progress game's numbers are missing.

## Create Game

- Game name and location **autofill from the most recent past game** (still editable).
- **Buy-in amount (stake) field** — host sets the game-wide buy-in amount (e.g. "2
  banks per buy-in"); this is required before "Start Game" enables. No per-player
  override — one value for the whole game, per `REQUIREMENTS.md`.
- No per-player buy-in *count* control — every added player gets exactly 1 buy-in
  automatically, at the stake set above.
- Player entry: segmented tabs **Your players / Contacts / Type in** (shadcn `Tabs`).
  - "Your players" = remembered roster (name + phone), tap to add.
  - "Contacts" = placeholder stub (no real device integration yet).
  - "Type in" = free text, **requires both name and phone** before a player can be
    added — phone is mandatory, not optional. Phone is normalized to E.164 on add
    (needed for claim-matching later).
  - Selected players stay visible as removable chips (✕) regardless of active tab,
    each chip showing name + phone. Removing a chip here is always safe — no buy-in
    exists yet at this stage.
- "Start Game" is **disabled until at least 1 player is added, a game name is set,
  and a buy-in amount is set**. This isn't cosmetic — a 0-player game breaks the Live
  Game screen's settle button, and an unset stake breaks the dashboard's by-stake
  chart grouping.
- After creating: a "copy WhatsApp invite" step generates formatted text (game name,
  location, time, invited player list, placeholder link) via
  `navigator.clipboard.writeText`. Stub — no real routing/verification yet.

### Edge cases
- ⚠️ **Duplicate phone number entered twice in "Type in"** (typo'd re-add, or the
  host genuinely doesn't remember they already added someone) — should warn and
  offer to reuse the existing chip rather than silently creating two player rows for
  one phone number.
- ⚠️ **Autofilled name/location from a past game the host no longer wants** — the
  autofill should be trivially clearable (not just editable character-by-character),
  e.g. a small "clear" affordance next to the prefilled fields.
- **Stake field entered as 0 or blank** — treat as unset, not "free buy-ins"; keep
  "Start Game" disabled rather than silently allowing a zero-stake game.

## Live Game

**Player list** (not the primary interaction surface — tapping is):

- Each row: name, buy-in count shown **large and bold** (the one dynamic number that
  matters most), a small status **dot** instead of a text badge (in-play vs.
  settled-win vs. settled-loss color), tap opens the bottom sheet.
- Per-row stub actions: send a "confirm your bank" check (toast stub), share cash-out
  details for a player quitting early (clipboard-copy stub).
- **Remove player** — only available for a row with zero buy-ins recorded (accidental
  add). Once any buy-in exists, the action disappears entirely rather than being
  disabled-with-tooltip, since it's genuinely no longer a valid action per
  `REQUIREMENTS.md`.

**Stats row**: on-table total, cashed-out total, rake (masked by default, tap to
reveal — rake is editable here up until the game closes, per the updated money
model; edits go through the same reveal-tap surface, not a separate screen).

**Live bankroll-check strip**: shows `buy-ins = cashed-out + rake + still in play` is
holding, or surfaces the real error case (`cash-outs + rake` exceeding buy-ins) as a
**non-blocking warning banner** naming the exact overage — visible both at the moment
it's triggered and persistently until resolved. Money still in play mid-game is
normal, not an error; don't flag it. This does **not** block further entry — only
closing the game is blocked while this banner is showing (see "End Game" below).

**Bottom sheet** (opens per player, single sheet, no tab navigation between buy-in and
cash-out):

- **Buy-in** is primary: big number + status dot, a slider (shadcn `Slider`, 0–30,
  ticks every 5) whose minimum floors at the player's already-locked buy-in count, a
  quiet "Locks in 1 min" caption (not a boxed warning), "Confirm N buy-ins" button.
  Once locked, the slider becomes fully non-interactive (not just floored) —
  `REQUIREMENTS.md` treats the lock as permanent with no override, so the UI
  shouldn't imply otherwise.
- **Cash out this player** is a small toggle (shadcn `Switch`) below the buy-in
  section — flipping it on **hides the buy-in slider/confirm entirely** (buy-ins lock
  while cashing out) and reveals: a small "N buy-ins · X banks in — locked while
  cashing out" reference line (buy-in figure shown **once**, not duplicated), a large
  "Cashing out" number, live net, a calculator keypad (0–9, ⌫, C), "Confirm cash out"
  button. After confirming, the sheet **stays editable** (re-openable, keypad
  re-enabled) until the game closes — cash-outs are not locked like buy-ins.

"End Game & Settle" button at the bottom, only rendered when `players.length > 0`
(consequence of the Create Game gate above). Tapping it is the explicit **close-game**
action from `REQUIREMENTS.md` — it's disabled (not hidden) while the overpay banner
is active, with inline copy explaining why, so the host isn't left guessing why the
button won't respond.

### Edge cases
- ⚠️ **Closing with players who never cashed out** (walked away, house absorbs it) —
  per `REQUIREMENTS.md`, closing shouldn't require every player to have a cash-out.
  Confirm this explicitly in the close-game confirmation dialog: "N players have no
  cash-out recorded — their buy-ins will count as a loss to the table. Continue?"
  rather than closing silently with an implicit assumption.
- ⚠️ **Re-opening the bottom sheet for a player already cashed out, after close** —
  should render read-only (numbers shown, no keypad/slider), not just fail silently
  or throw, since Game Detail links back here conceptually for hosts reviewing a
  closed game.
- **Rake edited after some cash-outs already entered** — recheck the overpay banner
  immediately on rake change, not just on cash-out entry; rake is part of the same
  invariant and editing it can trigger (or resolve) the same warning.

## Settlement

Computed transfers (winners paid by losers, rake excluded per the invariant) shown as
a list, each tappable to open an edit sheet: From/To as roster **chip pickers** (never
free text), amount via the same calculator keypad, Remove/Save actions. "Add custom
payment" opens the identical sheet blank. A balance-check message surfaces if buy-ins
and cash-outs don't reconcile (tolerance ~50 units for 100-unit display rounding).

Transfers are computed with a **deterministic tie-break** (ascending player ID on
equal nets, per `REQUIREMENTS.md`) — re-running settlement on the same closed game's
data always produces the same list, which matters if a host reopens this screen later
from Game Detail.

This screen is reached from "End Game & Settle" (pre-close, still editable) and, after
close, is stored and read-only from Game Detail (see below) — the editable Settlement
flow itself only exists in that pre-close window.

### Edge cases
- ⚠️ **Manually editing a transfer breaks the reconciliation total** — e.g. host
  changes an amount on one transfer without adjusting others. The balance-check
  message should recompute live as the host edits, not just once on screen load, so
  a host doesn't close the game on a settlement that no longer balances.
- ⚠️ **Removing a computed transfer entirely** (host wants to record it as "settled
  in person, no need to track") vs. **deleting because it's wrong** — same Remove
  action today; worth a quiet confirmation ("This player's transfer won't appear in
  the final settlement") so it doesn't read as recomputing the math, since removing a
  line doesn't rebalance the others automatically.

## Game Detail

**Role-aware** — this is not optional, it's the core privacy rule:

- If the viewer **is** the game's host: full breakdown — pot, player count, rake
  (masked/revealable), every player's in/out/net sorted by net, the settlement log.
- If the viewer **is not** the host (just a player in someone else's game): only their
  own buy-in, cash-out, and net. Nothing about other players, no rake, no leaderboard.
- **Live vs. closed**: a `live` game viewed here shows current-state numbers with a
  clear "Game in progress" indicator and a link back to Live Game for the host; a
  `closed` game shows the frozen, stored settlement computed at close time — these
  should not look identical, since one can still change and one never will again.

### Edge cases
- ⚠️ **Unclaimed player viewing their own game via a direct link** (before completing
  their profile / claiming) — if this is reachable at all pre-auth-linking, it must
  still enforce the non-host visibility rule; being unclaimed doesn't mean untrusted
  with other players' numbers.
- **Host viewing a closed game they also played in** — the "full breakdown" and
  "personal net" views need to coexist clearly (their own row shouldn't be visually
  ambiguous in the full player list), since a host is also always a player.

## Global

- Dark casino-felt theme throughout, now layered with shadcn/ui components mapped to
  the same tokens (see Theming section above) — no currency symbols anywhere, bank
  units only, whole numbers on display. Individual figures round independently;
  displayed totals are computed from full precision and rounded once, so a ±1 bank
  disagreement between a total and its visible parts is expected, not a bug (see
  `REQUIREMENTS.md`).
- Bottom nav: Home + Live (when a game's active) only — no History entry.
- `overflow-x: hidden` on `html, body` plus responsive `max-w-[430px] w-full`
  containers — don't reintroduce fixed pixel widths that could overflow on narrow
  phones.

### Edge cases
- ⚠️ **Offline / connection loss mid-entry** (buy-in tap, cash-out confirm, rake
  edit) — not addressed anywhere in either doc. Given this is a PWA and hosts will be
  using it at a table with patchy signal, worth deciding now whether writes queue
  locally and retry, or the UI blocks with a clear "no connection" state — silent
  data loss on a money-tracking app is the worst-case failure mode here.
