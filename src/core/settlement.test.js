import { describe, it, expect } from "vitest"
import { BANK } from "./money.js"
import { totalBuyinsFor, lockedCountFor, computeSettlement } from "./settlement.js"

const buyin = (amount, epoch) => ({ amount, epoch })

describe("totalBuyinsFor", () => {
  it("sums every buy-in regardless of how many discrete events it came from", () => {
    // This is the shape a host-set "starting buy-in count" of 3 produces —
    // three separate 1-bank events, not one 3-bank unit. See
    // REQUIREMENTS.md -> Money model.
    const p = { buyins: [buyin(BANK), buyin(BANK), buyin(BANK)] }
    expect(totalBuyinsFor(p)).toBe(3 * BANK)
  })
})

describe("lockedCountFor — bank-check locking", () => {
  it("locks nothing before the game's first bank check", () => {
    const p = { buyins: [buyin(BANK, 1000), buyin(BANK, 2000)] }
    const game = { lastBankCheckAt: null }
    expect(lockedCountFor(p, game)).toBe(0)
  })

  it("locks only buy-ins entered at or before the checkpoint", () => {
    const p = { buyins: [buyin(BANK, 1000), buyin(BANK, 2000), buyin(BANK, 3000)] }
    const game = { lastBankCheckAt: 2000 }
    expect(lockedCountFor(p, game)).toBe(2)
  })

  it("locking is a floor, never a ceiling — a buy-in added after the checkpoint stays unlocked", () => {
    const p = { buyins: [buyin(BANK, 1000), buyin(BANK, 5000)] }
    const game = { lastBankCheckAt: 2000 }
    expect(lockedCountFor(p, game)).toBe(1)
  })
})

describe("computeSettlement", () => {
  it("everyone even produces no transfers", () => {
    const players = [
      { name: "A", buyins: [buyin(BANK)], cashoutAmount: BANK },
      { name: "B", buyins: [buyin(BANK)], cashoutAmount: BANK },
    ]
    expect(computeSettlement(players)).toEqual([])
  })

  it("a single winner and loser produce exactly one transfer for the right amount", () => {
    const players = [
      { name: "Winner", buyins: [buyin(BANK)], cashoutAmount: 2 * BANK },
      { name: "Loser",  buyins: [buyin(BANK)], cashoutAmount: 0 },
    ]
    const txns = computeSettlement(players)
    expect(txns).toEqual([{ from: "Loser", to: "Winner", amount: BANK }])
  })

  it("breaks ties on equal net by ascending name, deterministically", () => {
    // Alice and Bob both net -1 bank; only one creditor (Cara, +2). Alice
    // sorts before Bob, so Alice's debt is settled first — rerunning this
    // must always produce the same order, which is the whole point of the
    // tie-break rule (REQUIREMENTS.md -> deterministic tie-break).
    const players = [
      { name: "Bob",   buyins: [buyin(BANK)], cashoutAmount: 0 },
      { name: "Alice", buyins: [buyin(BANK)], cashoutAmount: 0 },
      { name: "Cara",  buyins: [buyin(BANK)], cashoutAmount: 3 * BANK },
    ]
    const first = computeSettlement(players)
    const second = computeSettlement(players)
    expect(first).toEqual(second)
    expect(first[0]).toEqual({ from: "Alice", to: "Cara", amount: BANK })
    expect(first[1]).toEqual({ from: "Bob", to: "Cara", amount: BANK })
  })

  it("never produces a transfer touching rake — rake is not a player", () => {
    // Rake isn't part of a player's net at all (see money.js /
    // REQUIREMENTS.md), so there's nothing to assert here beyond: no
    // transfer's from/to is ever anything but a real player name.
    const players = [
      { name: "A", buyins: [buyin(BANK)], cashoutAmount: 1.5 * BANK },
      { name: "B", buyins: [buyin(BANK)], cashoutAmount: 0.5 * BANK },
    ]
    const txns = computeSettlement(players)
    const names = new Set(players.map(p => p.name))
    for (const t of txns) {
      expect(names.has(t.from)).toBe(true)
      expect(names.has(t.to)).toBe(true)
    }
  })
})
