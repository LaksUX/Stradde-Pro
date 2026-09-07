// ─── Money model — the fixed-scale invariant and its display/rounding rules ─
// [decision, see REQUIREMENTS.md -> Money model] 1 bank = 10,000 internal
// units, fixed, never change this scale. Every buy-in is always exactly 1
// bank. This exact line has been the source of two real bugs during
// development (a leftover x10 conversion, and an internal-storage constant
// of 1,000 instead of 10,000) — that history is why this constant now lives
// in exactly one place, imported everywhere else, rather than being
// re-typed per screen.
//
// This module has no React or DOM dependency on purpose: it's the part of
// the app meant to be reused unchanged by the future React Native rebuild
// (see docs/MOBILE_MIGRATION_PLAN.md, Phase 0) as well as by the current web
// app. Don't add a React import here — a component that needs one of these
// values imports the value, not the other way around.

export const BANK = 10000

// Rounding tolerance for the settlement/bankroll invariant checks below —
// amounts round to the nearest 100 units on screen, so allow half that as
// noise before treating a discrepancy as real.
export const BALANCE_TOLERANCE = 50

export const fmtBankNum = (n) => String(Math.round(Math.abs(n) / BANK))

// [decision] Display amounts as whole banks, no decimals. Only the display
// layer rounds — all stored/calculated amounts stay full-precision. Plain-
// text formatters (used for WhatsApp/clipboard share text and toasts, not
// for on-screen numeric display — see NumB in App.jsx for that).
export const fmtB = (n) => `${fmtBankNum(n)} ${Math.abs(n) / BANK === 1 ? "bank" : "banks"}`

export const fmtNet = (n) => {
  if (n === 0) return "Even"
  return `${n > 0 ? "+" : "−"}${fmtB(Math.abs(n))}`
}

// ─── Bankroll invariant ─────────────────────────────────────────────────────
// [decision, see REQUIREMENTS.md -> The rake/settlement invariant]
//   sum(all players' buy-ins) = sum(all players' cash-outs) + rake
// Centralized here because the same totals get derived differently by
// different screens: step 2/3 only flag genuine overpay (underpay is normal
// mid-game — money still on the table), while ending step 3 and closing the
// game require the books to balance exactly in both directions. Compute the
// shared totals once; let each call site derive the gate it actually needs.
export function computeBankroll(players, rake = 0) {
  const totalIn  = players.reduce((s, p) => s + p.buyins.reduce((bs, b) => bs + b.amount, 0), 0)
  const totalOut = players.reduce((s, p) => s + (p.cashoutAmount || 0), 0)
  const paidOut  = totalOut + (rake || 0)
  const diff     = totalIn - paidOut          // negative = overpaid, positive = still owed/uncounted
  const overpaid = paidOut - totalIn          // positive = a real error at any stage
  return {
    totalIn,
    totalOut,
    paidOut,
    stillIn: totalIn - totalOut,
    diff,
    overpaid,
    overpayError: overpaid > BALANCE_TOLERANCE,
    balanced: Math.abs(diff) < BALANCE_TOLERANCE,
  }
}
