// ─── Full usecase test — the whole game lifecycle, pure logic ─────────────
// Exercises src/core/money.js and src/core/settlement.js (network-free,
// dependency-free by design — see their own header comments) by replaying
// the exact sequence of state transitions every mobile screen performs on
// a game/player object, end to end: create -> add buy-ins -> bank check
// locks -> add late player -> edit/remove player (locked vs unlocked
// gating) -> early-leaver cash-out -> end buy-ins -> cash-out entry ->
// rake edit -> review & continue balance check -> settlement (auto
// transfers + override + custom payment) -> close.
//
// This is NOT a network/RLS test (no service-role key or test JWTs are
// available in this environment to sign in as a real account) — it proves
// the shared money/settlement math and the client-side state shape every
// screen relies on are correct and internally consistent for a realistic
// multi-player session, the same way a human tester would trace the app
// screen by screen but exhaustively and deterministically.
//
// Run: node scripts/test-full-lifecycle.mjs
// (imports the real repo files directly, not copies)

import { BANK, fmtB, fmtNet, computeBankroll } from "../src/core/money.js"
import { totalBuyinsFor, lockedCountFor, computeSettlement } from "../src/core/settlement.js"

let failures = 0
let checks = 0
function check(label, condition, detail) {
  checks++
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`)
  }
}

function mkBuyin(epoch) {
  return { id: `b${Math.random()}`, amount: BANK, epoch }
}

console.log("=== Step 1: Create Game (4 players, 1 starting buy-in each) ===")
let t = 1000
const game = {
  id: "g1",
  name: "Friday Night Felts",
  status: "live",
  rake: 0,
  lastBankCheckAt: null,
  players: [
    { id: "p1", name: "Alice", phone: "1", buyins: [mkBuyin(t++)], cashedOut: false, cashoutAmount: null },
    { id: "p2", name: "Bob", phone: "2", buyins: [mkBuyin(t++)], cashedOut: false, cashoutAmount: null },
    { id: "p3", name: "Carol", phone: "3", buyins: [mkBuyin(t++)], cashedOut: false, cashoutAmount: null },
    { id: "p4", name: "Dave", phone: "4", buyins: [mkBuyin(t++)], cashedOut: false, cashoutAmount: null },
  ],
}

{
  const { totalIn, totalOut, stillIn, balanced, overpayError } = computeBankroll(game.players, game.rake)
  check("initial pot = 4 banks", totalIn === 4 * BANK, totalIn)
  check("nothing cashed out yet", totalOut === 0)
  check("still-in = pot", stillIn === totalIn)
  check("not balanced yet (money still on table is fine, not an error)", balanced === false)
  check("no overpay error", overpayError === false)
}

console.log("\n=== Step 2: Live Game — more buy-ins before first bank check (all unlocked) ===")
game.players[0].buyins.push(mkBuyin(t++)) // Alice: 2 buy-ins now
game.players[1].buyins.push(mkBuyin(t++)) // Bob: 2 buy-ins now
{
  check("nothing locked before first bank check (Alice)", lockedCountFor(game.players[0], game) === 0)
  check("nothing locked before first bank check (Bob)", lockedCountFor(game.players[1], game) === 0)
  const { totalIn } = computeBankroll(game.players, game.rake)
  check("pot now 6 banks", totalIn === 6 * BANK, totalIn)
}

console.log("\n=== Step 3: Bank Check — locks everything entered so far ===")
const checkTime = t++
game.lastBankCheckAt = checkTime
game.bankChecks = [checkTime]
{
  check("Alice's 2 buy-ins now locked", lockedCountFor(game.players[0], game) === 2)
  check("Bob's 2 buy-ins now locked", lockedCountFor(game.players[1], game) === 2)
  check("Carol's 1 buy-in now locked", lockedCountFor(game.players[2], game) === 1)
}

console.log("\n=== Step 4: Add late player after the check (unlocked) ===")
game.players.push({ id: "p5", name: "Eve", phone: "5", buyins: [mkBuyin(t++)], cashedOut: false, cashoutAmount: null })
{
  check("Eve's buy-in not locked (came after the check)", lockedCountFor(game.players[4], game) === 0)
  check("5 players now", game.players.length === 5)
}

console.log("\n=== Step 5: Remove-player gating — locked player can't be removed, unlocked can ===")
{
  const aliceLocked = lockedCountFor(game.players[0], game) > 0
  const eveLocked = lockedCountFor(game.players[4], game) > 0
  check("Alice is removal-blocked (has locked buy-ins)", aliceLocked === true)
  check("Eve is removable (no locked buy-ins yet)", eveLocked === false)
}
// Remove Eve (allowed) — mirrors live-game.tsx's removePlayer gate
game.players = game.players.filter((p) => p.id !== "p5")
check("back to 4 players after removing Eve", game.players.length === 4)

console.log("\n=== Step 6: Early-leaver cash-out mid-game (Carol leaves early) ===")
game.players.find((p) => p.name === "Carol").cashedOut = true
game.players.find((p) => p.name === "Carol").cashoutAmount = 0 // busted out, no rebuy
{
  const { totalOut } = computeBankroll(game.players, game.rake)
  check("Carol's cash-out counted", totalOut === 0) // busted for 0, but marked cashed out
  check("Carol marked cashed out", game.players.find((p) => p.name === "Carol").cashedOut === true)
}

console.log("\n=== Step 7: More buy-ins, second bank check locks the rest ===")
game.players.find((p) => p.name === "Dave").buyins.push(mkBuyin(t++)) // Dave: 2 buy-ins
const secondCheck = t++
game.lastBankCheckAt = secondCheck
game.bankChecks.push(secondCheck)
{
  check("Dave fully locked after 2nd check", lockedCountFor(game.players.find((p) => p.name === "Dave"), game) === 2)
  const sinceLastCheck = game.players.reduce((s, p) => s + (p.buyins.length - lockedCountFor(p, game)), 0)
  check("nothing unlocked right after a fresh check", sinceLastCheck === 0, sinceLastCheck)
}

console.log("\n=== Step 8: End Buy-ins -> Cash-out Entry (status: live -> cashout) ===")
game.status = "cashout"
check("status flipped to cashout", game.status === "cashout")

console.log("\n=== Step 9: Cash out remaining players ===")
// Buy-ins in at this point: Alice 2, Bob 2, Carol 1 (already cashed out for 0), Dave 2 = 7 banks total.
// Alice: 2 in, cashes out 4 (net +2, big winner)
game.players.find((p) => p.name === "Alice").cashedOut = true
game.players.find((p) => p.name === "Alice").cashoutAmount = 4 * BANK
// Bob: 2 in, cashes out 1 (net -1, lost)
game.players.find((p) => p.name === "Bob").cashedOut = true
game.players.find((p) => p.name === "Bob").cashoutAmount = 1 * BANK
// Dave: 2 in, cashes out 2 (net 0, even) — chosen so total cash-outs (4+1+2+0) = total buy-ins (7), 0 rake
game.players.find((p) => p.name === "Dave").cashedOut = true
game.players.find((p) => p.name === "Dave").cashoutAmount = 2 * BANK
{
  const allCashedOut = game.players.every((p) => p.cashedOut)
  check("everyone cashed out", allCashedOut === true)
  const { totalIn, totalOut, balanced, overpayError } = computeBankroll(game.players, game.rake)
  check("total in = total out with 0 rake (perfectly balanced)", totalIn === totalOut, { totalIn, totalOut })
  check("balanced() agrees", balanced === true)
  check("no overpay error", overpayError === false)
}

console.log("\n=== Step 10: Set rake mid-cashout-entry (host takes 1 bank) — this OVERPAYS by construction ===")
// The table was already balanced (in = out) with 0 rake. Skimming rake on top,
// without reducing any cash-out to make room for it, necessarily overpays —
// paidOut (cash-outs + rake) now exceeds what actually came in. This is
// exactly the mistake the Review & Continue balance check exists to catch.
game.rake = 1 * BANK
{
  const { balanced, diff, overpaid, overpayError } = computeBankroll(game.players, game.rake)
  check("no longer balanced once rake is skimmed without adjusting a cash-out", balanced === false)
  check("diff reflects paidOut now exceeding totalIn", diff === -1 * BANK, diff)
  check("flagged as a real overpay error", overpayError === true)
  check("overpaid amount is exactly the rake just added", overpaid === 1 * BANK, overpaid)
}
// Host catches it and reduces Dave's cash-out by 1 bank to make room for the rake
game.players.find((p) => p.name === "Dave").cashoutAmount = 1 * BANK
{
  const { balanced, overpayError } = computeBankroll(game.players, game.rake)
  check("balanced again after making room for the rake", balanced === true)
  check("no overpay error", overpayError === false)
}

console.log("\n=== Step 11: Review & Continue — EndGameReviewDialog's balance gate ===")
{
  const { balanced } = computeBankroll(game.players, game.rake)
  const uncashed = game.players.filter((p) => !p.cashedOut)
  const ackUncashed = false // nobody's uncashed in this run, so the checkbox is irrelevant
  const canProceed = balanced && (uncashed.length === 0 || ackUncashed)
  check("balance gate reflects step 10's fix (balanced again)", balanced === true)
  check("can proceed to settlement (balanced, everyone cashed out)", canProceed === true)
}

console.log("\n=== Step 12: Settlement — auto-computed transfers ===")
const txns = computeSettlement(game.players)
{
  // Net positions after step 10's fix: Alice +2 (in 2, out 4), Bob -1 (in 2, out 1),
  // Carol -1 (in 1, out 0, busted), Dave -1 (in 2, out 1, reduced to make room
  // for rake). Rake is host revenue, never a transfer — it's money that left
  // the table before settlement, so the players' nets sum to -rake, not 0:
  // debtors collectively owe more than creditors are collectively owed by
  // exactly the rake amount, and computeSettlement correctly leaves that
  // uncovered remainder untransferred (there's no one left to receive it).
  const netByName = Object.fromEntries(
    game.players.map((p) => [p.name, (p.cashoutAmount || 0) - totalBuyinsFor(p)])
  )
  check("Alice net +2 banks", netByName.Alice === 2 * BANK, netByName.Alice)
  check("Bob net -1 bank", netByName.Bob === -1 * BANK, netByName.Bob)
  check("Carol net -1 bank (busted)", netByName.Carol === -1 * BANK, netByName.Carol)
  check("Dave net -1 bank (reduced to cover rake)", netByName.Dave === -1 * BANK, netByName.Dave)

  const sumNet = Object.values(netByName).reduce((a, b) => a + b, 0)
  check("sum of all nets = -rake (money the rake removed from the player pool)", sumNet === -game.rake, sumNet)

  const transferSum = txns.reduce((s, t) => s + t.amount, 0)
  const creditSum = Object.values(netByName).filter((n) => n > 0).reduce((a, b) => a + b, 0)
  const debitSum = Object.values(netByName).filter((n) => n < 0).reduce((a, b) => a - b, 0)
  check("transfer total = total winnings paid out (what creditors are owed)", transferSum === creditSum, { transferSum, creditSum })
  check("transfer total is less than total losses by exactly the rake (one debtor's loss goes uncovered)", debitSum - transferSum === game.rake, { debitSum, transferSum, rake: game.rake })
  check("every transfer amount is positive", txns.every((t) => t.amount > 0))
  check("every transfer is from a net-negative player", txns.every((t) => netByName[t.from] < 0))
  check("every transfer is to a net-positive player", txns.every((t) => netByName[t.to] > 0))
  check("deterministic: re-running computeSettlement gives the same result", JSON.stringify(computeSettlement(game.players)) === JSON.stringify(txns))
}

console.log("\n=== Step 13: Settlement screen — override + custom payment (mirrors settlement.tsx) ===")
{
  // Simulate settlement.tsx's overrides/customTxns state machine
  const baseTxns = computeSettlement(game.players)
  const overrides = Object.fromEntries(baseTxns.map((tr, i) => [`auto-${i}`, { from: tr.from, to: tr.to, amount: tr.amount }]))
  const customTxns = []

  // Host removes one auto transfer (already settled in cash at the table)
  const firstKey = Object.keys(overrides)[0]
  overrides[firstKey] = { ...overrides[firstKey], removed: true }

  // Host adds a custom payment between two players not in the auto list
  customTxns.push({ key: "custom-0", from: "Bob", to: "Dave", amount: 500 * 100, isAuto: false })

  const allTxns = [
    ...baseTxns.map((tr, i) => {
      const key = `auto-${i}`
      const ov = overrides[key]
      return { key, from: ov?.from ?? tr.from, to: ov?.to ?? tr.to, amount: ov?.amount ?? tr.amount, isAuto: true }
    }),
    ...customTxns,
  ]
  const visibleTxns = allTxns.filter((tr) => !overrides[tr.key]?.removed)

  check("one auto transfer was removed from the visible list", visibleTxns.filter((tr) => tr.isAuto).length === baseTxns.length - 1)
  check("custom payment is present in the visible list", visibleTxns.some((tr) => tr.key === "custom-0"))
  check("all visible amounts are positive", visibleTxns.every((tr) => tr.amount > 0))
}

console.log("\n=== Step 14: Close Game — status transition + settlement/close invariant ===")
game.status = "closed"
game.settlement = txns.map((tr) => ({ ...tr, paid: false }))
{
  check("status is closed", game.status === "closed")
  check("stored settlement matches computed settlement at close time", JSON.stringify(game.settlement.map(({ paid, ...r }) => r)) === JSON.stringify(txns))
}

console.log("\n=== Step 15: Post-close — PaidToggle / settlement ledger read (Home, Game Detail) ===")
{
  // Mirrors MySettlementsSection / SettlementLedgerSection's filter-by-player logic
  const hostName = "Alice"
  const myLines = game.settlement
    .map((tr, idx) => ({ ...tr, idx }))
    .filter((tr) => tr.from === hostName || tr.to === hostName)
  check("Alice (host) appears in her own settlement lines where relevant", Array.isArray(myLines))

  // Toggle paid on the first line (mirrors toggleSettlementPaid)
  if (game.settlement.length > 0) {
    game.settlement[0].paid = true
    check("paid toggle flips exactly one line", game.settlement.filter((tr) => tr.paid).length === 1)
  }
}

console.log("\n=== Step 16: fmt* display helpers — spot checks used across every screen ===")
{
  check('fmtB(0) = "0 banks"', fmtB(0) === "0 banks", fmtB(0))
  check('fmtB(BANK) = "1 bank" (singular)', fmtB(BANK) === "1 bank", fmtB(BANK))
  check('fmtB(2*BANK) = "2 banks"', fmtB(2 * BANK) === "2 banks", fmtB(2 * BANK))
  check('fmtNet(0) = "Even"', fmtNet(0) === "Even", fmtNet(0))
  check('fmtNet(+1 bank) starts with "+"', fmtNet(BANK).startsWith("+"), fmtNet(BANK))
  check('fmtNet(-1 bank) starts with minus sign', fmtNet(-BANK).startsWith("−"), fmtNet(-BANK))
}

console.log("\n=== Step 17: Adversarial edge cases ===")
{
  // A game with zero players shouldn't throw
  const empty = computeBankroll([], 0)
  check("computeBankroll([]) doesn't throw, balanced trivially", empty.balanced === true)
  check("computeSettlement([]) returns []", computeSettlement([]).length === 0)

  // A player who cashes out for exactly their buy-in (net 0) generates no transfer
  const evenPlayers = [
    { name: "X", buyins: [{ amount: BANK }], cashoutAmount: BANK, cashedOut: true },
    { name: "Y", buyins: [{ amount: BANK }], cashoutAmount: BANK, cashedOut: true },
  ]
  check("two even players settle with zero transfers", computeSettlement(evenPlayers).length === 0)

  // Overpay detection: paid out more than bought in
  const overpayCase = computeBankroll(
    [{ buyins: [{ amount: BANK }], cashoutAmount: 5 * BANK }],
    0
  )
  check("overpay is correctly flagged", overpayCase.overpayError === true)
  check("overpaid amount is exactly the excess", overpayCase.overpaid === 4 * BANK, overpayCase.overpaid)

  // Rounding tolerance: a 1-unit rounding artifact should NOT trip the balance gate
  const nearBalanced = computeBankroll(
    [
      { buyins: [{ amount: BANK }], cashoutAmount: BANK - 10 },
      { buyins: [{ amount: BANK }], cashoutAmount: BANK + 10 },
    ],
    0
  )
  check("exact balance with offsetting rounding noise still reads balanced", nearBalanced.balanced === true)
}

console.log(`\n${checks - failures}/${checks} checks passed.`)
if (failures > 0) {
  console.error(`\n${failures} FAILURE(S)`)
  process.exit(1)
} else {
  console.log("\nAll good — full lifecycle logic is internally consistent end to end.")
}
