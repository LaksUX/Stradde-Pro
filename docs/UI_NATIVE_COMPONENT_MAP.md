# UI → Native Component Map

Companion to `MOBILE_MIGRATION_PLAN.md`. That doc covers *when* to port each
screen; this one covers *what each piece becomes*, and — more importantly —
which pieces are a straight swap versus a genuine redesign. Ported verbatim,
a few of these would look like a website wearing a native shell rather than a
native app, which was the whole point of not just wrapping the PWA.

## Straight swaps — same idea, native component, low risk

| Web (Radix / custom) | Native equivalent | Notes |
|---|---|---|
| `Switch` (cash-out toggle) | RN `Switch` / UI-kit `Switch` | 1:1, no rethinking needed. |
| `Av` (gradient initials avatar) | Plain `View`+`Text` | No library needed either side. |
| Stat tiles, settlement lines, history rows, player chips | `View`/`Text` with flex layout | Just a styling-API swap (NativeWind). The *content* of these is fine; see touch-target note below for the chip specifically. |
| `Keypad` (custom numeric grid for cash-out entry) | Same custom grid, `Pressable` | Keep it custom rather than switching to the OS numeric keyboard — see "Native OS keyboard vs. custom keypad" below. |
| `DInput` (game name, location, phone, player name) | `TextInput` | Direct swap. Date and Time are the two exceptions — see below. |

## Needs a different native idiom, not just a different library

**Bottom sheets (`AppSheet`, i.e. Radix `Sheet`)** — this is the app's single most
mobile-native pattern already, and native will genuinely be *better* here, not
just equivalent. Recommend `@gorhom/bottom-sheet`: real gesture-driven
drag-to-dismiss, resizable detents, a proper backdrop — physics a web `Sheet`
(a fixed-position div with a CSS transition) can't give you. Used today for
buy-in/cash-out entry, adding a player mid-game, and editing a settlement line;
all three carry over as bottom sheets on mobile with no rethinking of *when*
to use one, just a better implementation of it.

**Modal dialogs (`Dialog` — `EndGameModal`, the admin "Revoke host approval?"
confirm)** are two different things wearing the same web component, and they
should become two different native things:
- The revoke-approval confirm is a short yes/no interruption. On mobile the
  idiomatic version is a genuinely native alert (`Alert.alert`, which renders
  a real `UIAlertController` on iOS and `AlertDialog` on Android) — not a
  custom-styled card. Free, and it's the one place users have the strongest
  platform-native expectation.
- `EndGameModal` is a whole scrollable review screen (balance check, per-player
  breakdown) — too much content for an alert, and a centered card is a
  distinctly desktop/web pattern on a phone. Recommend it become a large
  bottom sheet (same `@gorhom/bottom-sheet` as above) rather than a modal
  dialog — reuses a component you're already building instead of adding a
  third pattern.

**Tabs vs. segmented control** — on web, `HomeScreen`'s Overview/Settlements
tabs and `SegTabs`'s "Your players / Contacts / Type in" filter are *literally
the same underlying Radix `Tabs` component*, just restyled. They're not the
same idiom on native, and shouldn't share one control there either:
- Overview/Settlements is section-level navigation → a real tab bar (or
  top-tab if you want it inside the screen rather than at the app root).
- The player-source filter is an in-page toggle over content that stays on
  screen → a segmented control (iOS has a real native one; Material's nearest
  equivalent is a toggle-button/chip group). Same for the Host/Player pill
  filter on Home.

Picking the UI kit (open decision in the migration plan) should specifically
be checked against having *both* of these as distinct, reasonably native-
looking primitives — not just "has tabs."

**The buy-in slider (`BuyinSlider`)** is worth reconsidering rather than
just re-implementing. It's a 0–30 range, integer steps, with a locked-floor
region rendered as a colored overlay under the track — that overlay is custom
render code that will need rebuilding against whichever slider library you
pick, since track-customization APIs differ (RN's built-in slider was removed
from core; `@react-native-community/slider` or the UI kit's own is needed
either way). But the more basic question: is a slider even the right control
for "how many buy-ins does this player have"? Sliders suit continuous or
wide-range values (volume, brightness); hitting an exact integer like 7 by
dragging is imprecise on a touchscreen. You already built a stepper
(plus/minus with a number readout) for the starting-buy-in count in the last
feature — using the same pattern here instead of a slider would be more
precise *and* more consistent within the app, not just a native-feel
improvement. Worth deciding deliberately rather than porting the slider
because it's what's already there.

**Toast** — genuinely different native expectations per platform. Android has
a first-class system pattern here (Toast/Snackbar); iOS has **no** system-level
toast at all — anything you see on iOS is an app emulating the pattern.
Recommend keeping a single custom toast component consistent across both
platforms (very common and accepted — most fintech/consumer RN apps do
exactly this, e.g. via `react-native-toast-message`) rather than going native
on Android and inventing something else for iOS. Flagging this as a conscious
choice, not a default.

**Date and Time fields** — currently plain free-text inputs (`date` is a typed
string like `"7 Sep"`, not a real date). This was already flagged in the
migration plan as a data problem (sorting/trend charts built on display
strings); from a *components* angle it's also a straightforward native upgrade
sitting right there for free: `@react-native-community/datetimepicker` wraps
the real native wheel/calendar picker on both platforms. Doing this at the
same time as the Phase-1 move to real timestamps means the fix happens once,
not as a UI patch now and a data-model patch later.

**The net-trend chart (`NetTrendChart`)** is hand-rolled inline SVG with a
manual stroke-dashoffset draw-in animation — React Native has no SVG or CSS
transitions built in. This is the one component here that's a genuine rebuild,
not a swap: `react-native-svg` for the shapes (API maps closely enough that
the path-generation math carries over) plus Reanimated for the draw-in
animation (CSS transitions have no RN equivalent). Budget real time for this
one specifically.

**"Contacts" source tab** — currently a UI placeholder with no real picker
behind it (a known, documented gap). Going native is what actually makes a
real contacts picker possible (`expo-contacts`) — worth noting as a natural
side benefit of the platform move, the same way Phase 1's Supabase move
closes several Known Gaps as a byproduct. Not scope to force into this pass,
just worth knowing it's now cheap.

## Cross-cutting things a visual port would miss entirely

- **`hover:` has no meaning on a touchscreen.** The codebase uses Tailwind
  `hover:` states throughout (buttons, chips, list rows) — every one of these
  needs to become an explicit pressed/active state instead (opacity or scale
  down on press, or platform ripple on Android via `Pressable`'s
  `android_ripple`). Not optional per-component; it's every interactive
  element in the app.
- **Touch targets — the starting-buy-in stepper is too small as built.** The
  plus/minus buttons in the player chip are ~16px, crammed next to a separate
  ✕ remove button, in a design that assumed a mouse pointer. Apple and Google
  both recommend ~44pt/48dp minimum touch targets; this specific control needs
  more room on mobile, not just a component-for-component port. Likely fix:
  give the stepper its own row instead of squeezing it into the compact chip,
  or size the chip up specifically when the stepper is present.
- **No gestures exist today.** The web app is entirely tap-driven — no
  swipe-to-delete on list rows, no swipe-to-dismiss on sheets. Native users
  expect these; `@gorhom/bottom-sheet` gives dismiss-by-swipe for free, but
  swipe-to-delete on history/settlement rows would be new work worth planning
  for rather than discovering is "missing" after launch.
- **Haptics are a zero-cost way to deliver on "performance & feel"** — one of
  the stated reasons for going native in the first place, and the web app has
  no equivalent at all. `expo-haptics` on the stepper taps, buy-in
  add/cash-out confirm, and slider (or stepper) changes is a small addition
  with an outsized effect on "feels native."
- **Native OS keyboard vs. custom keypad.** Keep the custom `Keypad` for
  cash-out amount entry rather than switching to the OS numeric keyboard —
  it appears inside a bottom sheet, and the OS keyboard sliding up over a
  bottom sheet is a routine native headache (covered inputs, resize jank).
  The plain text fields elsewhere (player name/phone, location) do need
  proper keyboard-avoidance handling (`KeyboardAvoidingView` or the
  equivalent in your nav library) wherever they sit inside a sheet or scroll
  view — easy to underestimate, easy to get wrong.
- **Pull-to-refresh** on the Home game lists has no current web equivalent
  and is a near-zero-cost native addition (`RefreshControl`) that reads as
  "real app" the moment it's there.

## Bottom line

Most of the app's *content* components (stat tiles, list rows, chips, avatars)
are a mechanical port. The places worth real design attention before writing
code are: bottom sheets replacing both `Sheet` and the review-style `Dialog`,
splitting tabs-as-navigation from segmented-control-as-filter instead of
reusing one primitive for both, reconsidering the buy-in slider against the
stepper pattern you already built, deciding the toast approach deliberately,
and treating touch targets and hover-state removal as a pass across the whole
app rather than a per-component afterthought.
