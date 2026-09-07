import { describe, it, expect } from "vitest"
import { BANK, BALANCE_TOLERANCE, fmtBankNum, fmtB, fmtNet, computeBankroll } from "./money.js"

describe("BANK scale", () => {
  it("is 10,000 — this exact value has broken twice before, pin it", () => {
    expect(BANK).toBe(10000)
  })
})

describe("fmtBankNum / fmtB", () => {
  it("rounds to the nearest whole bank", () => {
    expect(fmtBankNum(24999)).toBe("2") // 2.4999 banks -> rounds down... see next case
    expect(fmtBankNum(25001)).toBe("3") // 2.5001 banks -> rounds up
  })
  it("singularizes exactly 1 bank, pluralizes everything else including 0", () => {
    expect(fmtB(BANK)).toBe("1 bank")
    expect(fmtB(0)).toBe("0 banks")
    expect(fmtB(2 * BANK)).toBe("2 banks")
  })
  it("takes the absolute value — a negative amount still reads as a plain count", () => {
    expect(fmtB(-3 * BANK)).toBe("3 banks")
  })
})

describe("fmtNet", () => {
  it("reads exactly zero as Even, not +0 or -0", () => {
    expect(fmtNet(0)).toBe("Even")
  })
  it("signs positive and negative nets distinctly", () => {
    expect(fmtNet(2 * BANK)).toBe("+2 banks")
    expect(fmtNet(-2 * BANK)).toBe("−2 banks")
  })
})

// A minimal player shape for computeBankroll — only buyins/cashoutAmount
// matter to it, so tests build the smallest object that satisfies that.
const player = (buyinCount, cashoutAmount = null) => ({
  buyins: Array.from({ length: buyinCount }, () => ({ amount: BANK })),
  cashoutAmount,
})

describe("computeBankroll", () => {
  it("treats money still on the table mid-game as normal, not an error", () => {
    // Two players bought in, nobody's cashed out yet.
    const r = computeBankroll([player(1), player(1)], 0)
    expect(r.totalIn).toBe(2 * BANK)
    expect(r.stillIn).toBe(2 * BANK)
    expect(r.overpayError).toBe(false)
    expect(r.balanced).toBe(false) // not balanced either — just not an *error* yet
  })

  it("flags overpay when cashouts + rake exceed total buy-ins", () => {
    const r = computeBankroll([player(1, 2 * BANK)], 0) // paid out 2, only 1 came in
    expect(r.overpayError).toBe(true)
  })

  it("is balanced exactly at buy-ins = cash-outs + rake", () => {
    const r = computeBankroll([player(2, BANK)], BANK) // 2 in, 1 out + 1 rake = 2
    expect(r.balanced).toBe(true)
    expect(r.overpayError).toBe(false)
  })

  it("tolerates rounding noise within BALANCE_TOLERANCE but not beyond it", () => {
    const justInside = computeBankroll([player(1, BANK - (BALANCE_TOLERANCE - 1))], 0)
    expect(justInside.balanced).toBe(true)
    const justOutside = computeBankroll([player(1, BANK - (BALANCE_TOLERANCE + 1))], 0)
    expect(justOutside.balanced).toBe(false)
  })
})
