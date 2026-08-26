// ─── Shared roster (host's known players) ──────────────────────────────────
// [decision, interim] Persisted via localStorage, not the database, for now
// (see REQUIREMENTS.md → Roster). Real game screens are still local React
// state, so there's nowhere server-side to durably store this yet.
// `known_players` already exists in supabase/schema.sql and is unused —
// moving roster storage there is part of the eventual Supabase-wiring phase.
//
// This is the SINGLE source of truth for "Your players" — used by both
// CreateGameScreen and LiveGameScreen's "Add late player" flow, so a player
// added anywhere shows up everywhere else next time.

const ROSTER_KEY = "poker-night:roster"

function readRoster() {
  try {
    const raw = localStorage.getItem(ROSTER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeRoster(roster) {
  try {
    localStorage.setItem(ROSTER_KEY, JSON.stringify(roster))
  } catch {
    // localStorage unavailable (private mode, quota, etc.) — roster just
    // won't persist across reloads this session; not fatal.
  }
}

// Seed from past games' player data ONLY if localStorage is empty, so a
// fresh browser still sees the demo roster, but real usage persists
// correctly after that first read.
export function loadRoster(pastGames = []) {
  const existing = readRoster()
  if (existing) return existing
  const seeded = [
    ...new Map(
      pastGames.flatMap(g => g.players.map(p => [p.name.toLowerCase(), { name: p.name, phone: p.phone || "" }]))
    ).values(),
  ]
  writeRoster(seeded)
  return seeded
}

// Add-or-update, dedupe by name case-insensitive (matches the dedupe pattern
// previously used inline in CreateGameScreen's addPlayer). Returns the new
// roster array.
export function upsertRoster(roster, name, phone) {
  const n = (name || "").trim()
  const ph = (phone || "").trim()
  if (!n) return roster
  const idx = roster.findIndex(r => r.name.toLowerCase() === n.toLowerCase())
  let next
  if (idx >= 0) {
    next = roster.slice()
    next[idx] = { name: n, phone: ph || roster[idx].phone || "" }
  } else {
    next = [...roster, { name: n, phone: ph }]
  }
  writeRoster(next)
  return next
}
