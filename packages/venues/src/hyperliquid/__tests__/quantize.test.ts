/**
 * W6 — Hyperliquid quantization.
 *
 * The expectations are live order-book prices, not derived from the code under
 * test: BTC rests at `77902.0`, ETH at `2446.8`, DOGE at `0.085362`, spot
 * `@173` at `117667.0`, spot `@201` at `0.00000011`. If the grid rule is wrong,
 * these fail.
 *
 * The property at the bottom is the one that matters most. Quantization is
 * allowed to move a price; it is never allowed to move it toward the market.
 */
import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { money } from "@slipstream/shared"
import type { Decimal } from "@slipstream/shared"
import { asMarketId } from "@slipstream/shared"
import {
  MAX_PRICE_SIG_FIGS,
  buildConstraints,
  priceDecimalsFor,
  quantizeOrder,
  quantizePrice,
  quantizeSize,
  type AssetSpec,
  type HyperliquidMarketKind,
} from "../quantize.js"

/** Mirrors what `buildCatalog` produces, including spot's fixed 1x leverage. */
const spec = (
  name: string,
  kind: HyperliquidMarketKind,
  szDecimals: number,
  maxLeverage = kind === "spot" ? 1 : 10,
): AssetSpec => ({
  marketId: asMarketId(name),
  coin: name,
  symbol: name,
  kind,
  szDecimals,
  isDelisted: false,
  constraints: buildConstraints(kind, szDecimals, maxLeverage),
})

const BTC = spec("BTC", "perp", 5, 40)
const ETH = spec("ETH", "perp", 4, 25)
const DOGE = spec("DOGE", "perp", 0, 10)
const RUB = spec("@173", "spot", 5)
const HREKT = spec("@201", "spot", 0)

const px = (s: string): Decimal => money.parse(s)
const fmt = (d: Decimal | null): string | null => (d === null ? null : money.format(d))

describe("constraints", () => {
  it("derives tick and lot from szDecimals, per market kind", () => {
    // BTC szDecimals 5: sizes step 0.00001, prices carry 6 - 5 = 1 decimal.
    expect(money.format(BTC.constraints.sizeLot)).toBe("0.00001")
    expect(money.format(BTC.constraints.priceTick)).toBe("0.1")
    // Spot allows 8 - szDecimals decimals, which is why @201 can quote 1e-8.
    expect(money.format(HREKT.constraints.priceTick)).toBe("0.00000001")
    expect(money.format(HREKT.constraints.sizeLot)).toBe("1")
  })

  it("reports leverage and shorting as capabilities, never hardcoded", () => {
    expect(money.format(BTC.constraints.maxLeverage)).toBe("40")
    expect(BTC.constraints.supportsShort).toBe(true)
    expect(BTC.constraints.supportsReduceOnly).toBe(true)
    // Spot has no borrow, so there is nothing to short and nothing to reduce.
    expect(money.format(RUB.constraints.maxLeverage)).toBe("1")
    expect(RUB.constraints.supportsShort).toBe(false)
    expect(RUB.constraints.supportsReduceOnly).toBe(false)
  })

  it("never lets the decimal budget go negative", () => {
    // USDC-like base token: szDecimals 8 on a spot pair leaves no decimals.
    expect(priceDecimalsFor("spot", 8)).toBe(0)
    expect(priceDecimalsFor("perp", 6)).toBe(0)
  })
})

describe("quantizePrice — direction", () => {
  it("floors a buy and ceils a sell", () => {
    // ETH: the 5-significant-figure cap binds before the 2-decimal cap, which is
    // why the live book quotes 2446.8 and not 2446.85.
    expect(fmt(quantizePrice(ETH, "buy", px("2446.8543")))).toBe("2446.8")
    expect(fmt(quantizePrice(ETH, "sell", px("2446.8543")))).toBe("2446.9")
  })

  it("leaves a price already on the grid alone, whichever side", () => {
    for (const side of ["buy", "sell"] as const) {
      expect(fmt(quantizePrice(ETH, side, px("2446.8")))).toBe("2446.8")
      expect(fmt(quantizePrice(DOGE, side, px("0.085362")))).toBe("0.085362")
    }
  })
})

describe("quantizePrice — the grid", () => {
  it("applies the decimal cap when it is the binding one", () => {
    // DOGE szDecimals 0: 6 decimals, and 0.085362 is 5 significant figures, so
    // both caps land on the same step. Live book value.
    expect(fmt(quantizePrice(DOGE, "buy", px("0.0853625")))).toBe("0.085362")
    expect(fmt(quantizePrice(DOGE, "sell", px("0.0853625")))).toBe("0.085363")
    // Four significant figures: here only the decimal cap binds.
    expect(fmt(quantizePrice(DOGE, "buy", px("0.00365512")))).toBe("0.003655")
  })

  it("gives spot eight decimals, not six", () => {
    // @201 rests at 0.00000011 live. Under a 6-decimal cap this whole market
    // quantizes to zero, which is the failure this test exists to catch.
    expect(fmt(quantizePrice(HREKT, "buy", px("0.000000117")))).toBe("0.00000011")
    expect(fmt(quantizePrice(HREKT, "sell", px("0.000000117")))).toBe("0.00000012")
  })

  it("allows an integer price with more than five significant figures", () => {
    // @173 rests at 117667.0 live: six significant figures, legal because it is
    // an integer. Without the integer exemption this floors to 117660.
    expect(fmt(quantizePrice(RUB, "buy", px("117667.9")))).toBe("117667")
    expect(fmt(quantizePrice(RUB, "sell", px("117667.1")))).toBe("117668")
    // BTC: same rule on a perp. The live book quotes whole dollars.
    expect(fmt(quantizePrice(BTC, "buy", px("77902.531")))).toBe("77902")
    expect(fmt(quantizePrice(BTC, "sell", px("77902.531")))).toBe("77903")
  })

  it("carries no scale the venue would reject", () => {
    // quantizeToStep widens to the input's scale; a "77902.000" here would be
    // three decimals on a market that allows one.
    expect(money.format(quantizePrice(BTC, "buy", px("77902.531")))).toBe("77902")
    expect(money.format(quantizePrice(ETH, "buy", px("2446.85430000")))).toBe("2446.8")
  })

  it("leaves a zero price alone rather than dividing by its magnitude", () => {
    expect(fmt(quantizePrice(BTC, "buy", px("0")))).toBe("0")
  })
})

describe("quantizeSize", () => {
  it("truncates toward zero onto the lot", () => {
    // BTC szDecimals 5. Rounding up here would open a bigger position than asked.
    expect(money.format(quantizeSize(BTC, px("5.9999512")))).toBe("5.99995")
    expect(money.format(quantizeSize(BTC, px("5.9999599")))).toBe("5.99995")
    // DOGE szDecimals 0: whole coins only.
    expect(money.format(quantizeSize(DOGE, px("1234.987")))).toBe("1234")
  })

  it("truncates a sub-lot size to zero rather than rounding it up", () => {
    expect(money.format(quantizeSize(BTC, px("0.000001")))).toBe("0.00000")
  })
})

describe("quantizeOrder — belowMinimum", () => {
  it("flags an order that quantized away to nothing", () => {
    const result = quantizeOrder(BTC, "buy", px("77902"), px("0.000001"))
    expect(money.format(result.size)).toBe("0.00000")
    expect(result.belowMinimum).toBe(true)
  })

  it("flags an order under the $10 venue minimum, and passes one over it", () => {
    expect(quantizeOrder(BTC, "buy", px("77902.5"), px("0.0001")).belowMinimum).toBe(true)
    expect(quantizeOrder(BTC, "buy", px("77902.5"), px("0.0002")).belowMinimum).toBe(false)
  })

  it("cannot judge notional without a price, and says so by not flagging", () => {
    const marketOrder = quantizeOrder(BTC, "buy", null, px("0.0001"))
    expect(marketOrder.price).toBeNull()
    expect(marketOrder.belowMinimum).toBe(false)
    // A zero size is still caught: that needs no price.
    expect(quantizeOrder(BTC, "buy", null, px("0.0000001")).belowMinimum).toBe(true)
  })
})

/** Decimal places in the canonical string. */
const decimalsOf = (d: Decimal): number => {
  const dot = money.format(d).indexOf(".")
  return dot < 0 ? 0 : money.format(d).length - dot - 1
}

/** Significant figures, ignoring leading zeros and the decimal point. */
const sigFigsOf = (d: Decimal): number => {
  const digits = money.format(d).replace("-", "").replace(".", "").replace(/^0+/, "")
  return digits.replace(/0+$/, "").length || 1
}

const isInteger = (d: Decimal): boolean => !money.format(d).includes(".")

describe("quantizePrice — invariants over arbitrary prices", () => {
  const markets = [BTC, ETH, DOGE, RUB, HREKT]

  it("never moves a price toward the market, and always lands on the grid", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 ** 12 }),
        fc.integer({ min: 0, max: 12 }),
        fc.constantFrom(...markets),
        fc.constantFrom("buy" as const, "sell" as const),
        (mantissa, scale, market, side) => {
          const price = money.fromBigInt(BigInt(mantissa), scale)
          const q = quantizePrice(market, side, price)

          // 1. Direction: a buy never quantizes upward, a sell never downward.
          //    This is the invariant that stops quantization crossing a spread.
          if (side === "buy") expect(money.lte(q, price)).toBe(true)
          else expect(money.gte(q, price)).toBe(true)

          // 2. Both venue caps hold at once on the result.
          expect(decimalsOf(q)).toBeLessThanOrEqual(
            priceDecimalsFor(market.kind, market.szDecimals),
          )
          if (!isInteger(q)) expect(sigFigsOf(q)).toBeLessThanOrEqual(MAX_PRICE_SIG_FIGS)
        },
      ),
      { numRuns: 2000 },
    )
  })

  it("never rounds a size up", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 ** 12 }),
        fc.integer({ min: 0, max: 12 }),
        fc.constantFrom(...markets),
        (mantissa, scale, market) => {
          const size = money.fromBigInt(BigInt(mantissa), scale)
          expect(money.lte(quantizeSize(market, size), size)).toBe(true)
        },
      ),
      { numRuns: 1000 },
    )
  })
})
