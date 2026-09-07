// ─── Settlement "paid" status — MIGRATION ONLY ─────────────────────────────
// [superseded] This used to be the live store for per-transfer paid/pending
// flags, kept separate from the games (keyed by game id + the transfer's
// index in that game's `settlement` array) because games themselves weren't
// persisted at all and a full pastGames cache would have shadowed the demo
// seed data.
//
// Games are now persisted properly (src/lib/gameStore.js), so the flag lives
// on the transfer object itself and is saved with the game. Keeping a second
// copy here would just be two stores for one fact, which is how they drift —
// and index-keying is fragile the moment a settlement array is ever edited
// or recomputed.
//
// `applyPaidStatus` survives only to carry flags written by the older
// version into the new store, once, the first time an account's games are
// seeded. Nothing writes to this key any more; it can be deleted outright
// once no browser is likely to still hold the old data.
//
// [decision] Only the account that's currently signed in can flip this
// toggle (there's no separate logged-in "other player" to ask for a second
// confirmation yet — see REQUIREMENTS.md → Known gaps, "no live database on
// game screens"). A real two-party mark/confirm flow (mirroring the
// markPaid/confirmPaid pattern from the sibling Straddle project) is a
// reasonable future upgrade once players have real accounts, not built now.

const KEY = "poker-night:settlement-paid"

function readMap() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

const statusKey = (gameId, index) => `${gameId}:${index}`

// Applies any persisted paid/pending overrides onto a games array (seed data
// or freshly-closed games) without mutating the input.
export function applyPaidStatus(games) {
  const map = readMap()
  if (Object.keys(map).length === 0) return games
  return games.map(g => {
    if (!g.settlement || g.settlement.length === 0) return g
    let changed = false
    const next = g.settlement.map((t, i) => {
      const k = statusKey(g.id, i)
      if (k in map && !!t.paid !== !!map[k]) {
        changed = true
        return { ...t, paid: !!map[k] }
      }
      return t
    })
    return changed ? { ...g, settlement: next } : g
  })
}

// [removed] setPaidStatus() is gone — the paid flag is written onto the
// transfer and persisted with its game now. Nothing should write to this
// key again.
