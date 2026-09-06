// ─── Settlement "paid" status (interim, localStorage-backed) ──────────────
// [decision, interim] Same rationale as roster.js: game/settlement data is
// still local React state (see REQUIREMENTS.md → Known gaps), so there's
// nowhere server-side yet to durably store a per-transfer "paid" flag.
// Persisted separately from the games themselves (keyed by game id + the
// transfer's index within that game's stored `settlement` array) rather than
// folding it into a full pastGames cache, so it survives reloads without
// shadowing future edits to the seed/demo data — only the paid/pending bit
// is cached, nothing about the games or amounts themselves.
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

function writeMap(map) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    // localStorage unavailable (private mode, quota, etc.) — status just
    // won't persist across reloads this session; not fatal.
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

export function setPaidStatus(gameId, index, paid) {
  const map = readMap()
  map[statusKey(gameId, index)] = paid
  writeMap(map)
}
