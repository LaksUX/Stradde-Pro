// ─── Game persistence (interim, localStorage-backed) ───────────────────────
// [decision] The live game and every closed game are persisted locally, so a
// refresh, an accidental tab close, or a phone locking mid-game no longer
// destroys the night's numbers.
//
// Before this, `activeGame` and `pastGames` were plain React state with no
// persistence at all: reloading during a game lost the entire game, and
// reloading after closing one silently reverted history to the demo seed
// data. That made the app unusable for a real game night, which outranks
// every other item in REQUIREMENTS.md → Known gaps.
//
// [decision] Scoped per account id. localStorage is per-browser, so without
// scoping two accounts signing in on the same browser would see each other's
// games — names and phone numbers are real PII even in a play-money app.
// Signing out clears the in-memory state but leaves that account's own
// stored games intact for their next sign-in.
//
// [decision, interim] Still localStorage rather than Supabase — same
// rationale and same stopgap as roster.js and settlementStatus.js. Be clear
// about what this does and doesn't buy: it is DURABILITY, not SYNC. The game
// survives a reload on the same device/browser; it does not follow the host
// to another device, and it is not a substitute for wiring the game screens
// to the database (see REQUIREMENTS.md → Known gaps). It closes the
// data-loss hole, not the multi-device or access-control one.

const KEY_PREFIX = "poker-night:games:"
const VERSION = 1

const keyFor = (accountId) => `${KEY_PREFIX}${accountId || "anon"}`

// Returns { activeGame, pastGames, seeded }. `seeded` is true when nothing
// was stored for this account yet and `seed` was used instead — the caller
// uses that to run one-time migrations (see applyPaidStatus in App.jsx).
export function loadGames(accountId, seed = []) {
  try {
    const raw = localStorage.getItem(keyFor(accountId))
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && parsed.version === VERSION && Array.isArray(parsed.pastGames)) {
        return {
          activeGame: parsed.activeGame || null,
          pastGames: parsed.pastGames,
          seeded: false,
        }
      }
      // Unrecognised or older shape — fall through to a fresh seed rather
      // than guessing at a migration for a format we don't know.
    }
  } catch {
    // Corrupt JSON, or localStorage unavailable (private mode, quota) —
    // fall through to the seed rather than crashing the app on boot.
  }
  return { activeGame: null, pastGames: seed, seeded: true }
}

// Returns false if the write failed, so the caller can tell the host their
// game isn't being saved — silently failing here would recreate exactly the
// data-loss problem this file exists to fix.
export function saveGames(accountId, activeGame, pastGames) {
  try {
    localStorage.setItem(keyFor(accountId), JSON.stringify({
      version: VERSION,
      savedAt: Date.now(),
      activeGame: activeGame || null,
      pastGames: pastGames || [],
    }))
    return true
  } catch {
    return false
  }
}
