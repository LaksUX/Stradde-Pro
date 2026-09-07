// ─── Settlement + bank-check locking — dependency-free, see money.js ───────
// Same rule as money.js: no React/DOM import here. This is the logic meant
// to survive the native rebuild unchanged (docs/MOBILE_MIGRATION_PLAN.md).

export const totalBuyinsFor = (p) => p.buyins.reduce((s, b) => s + b.amount, 0)

// [decision, see REQUIREMENTS.md -> Money model, supersedes the old
// 60-second auto-lock] A buy-in locks when the host runs a bank check and
// confirms — not on a timer. Everything entered before
// `game.lastBankCheckAt` is locked; everything after stays freely editable
// until the next check. Before a game's first check, nothing is locked at
// all, no matter how long ago it was entered.
export const lockedCountFor = (p, game) =>
  p.buyins.filter(b => b.epoch != null && b.epoch <= (game.lastBankCheckAt || 0)).length

// ─── Deterministic settlement (debt simplification) ────────────────────────
// [decision, see REQUIREMENTS.md -> The rake/settlement invariant] Winners
// are paid by losers, biggest matched against biggest, rake excluded (rake
// never appears as a transfer). Ties on remaining net — both the initial
// sort and mid-simplification remainders — are broken by ascending player
// name, since this local-state model has no numeric player id. This
// guarantees the same inputs always produce the same transfer list, which
// matters for testing and for players double-checking math across sessions.
export function computeSettlement(players) {
  const positions = players.map(p => ({
    name: p.name,
    net: Math.round((p.cashoutAmount || 0) - totalBuyinsFor(p)),
  }))
  const byNetThenName = (a, b) => (b.rem - a.rem) || a.name.localeCompare(b.name)
  const debtors   = positions.filter(p => p.net < 0).map(p => ({ ...p, rem: -p.net })).sort(byNetThenName)
  const creditors = positions.filter(p => p.net > 0).map(p => ({ ...p, rem: p.net })).sort(byNetThenName)
  const out = []
  let di = 0, ci = 0
  while (di < debtors.length && ci < creditors.length) {
    const d = debtors[di], c = creditors[ci]
    const amt = Math.min(d.rem, c.rem)
    if (amt > 0) out.push({ from: d.name, to: c.name, amount: Math.round(amt) })
    d.rem -= amt; c.rem -= amt
    if (d.rem < 1) di++
    if (c.rem < 1) ci++
  }
  return out
}
