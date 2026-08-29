/**
 * W7 — quantization rules.
 *
 * The invariant under test everywhere below: quantization may round an order
 * *down* in aggression, never up. A buy that gets rounded toward the ask, or a
 * size that gets rounded up, is a position larger or dearer than anyone asked
 * for — and on a venue with no shorting there is no cheap way back out.
 */
import { describe, expect, it } from "vitest"
import fc from "fast-check"
import { money } from "@slipstream/shared"
import {
  DEFAULT_MARKET_RULES,
  MIN_ORDER_NOTIONAL,
  MIN_ORDER_SHARES,
  PRICE_TICK_DEFAULT,
  SIZE_LOT,
  polymarketConstraints,
  quantizePolymarketOrder,
} from "../quantize.js"

const d = (s: string) => money.parse(s)
const f = (x: { mantissa: bigint; scale: number }) => money.format(x)

/** A market on the coarse tick. 119 of 500 live open markets sampled on
 *  2026-08-29 reported this tick rather than 0.001. */
const COARSE = { priceTick: d("0.01"), minOrderShares: MIN_ORDER_SHARES }

describe("polymarketConstraints", () => {
  it("declares the venue's capabilities rather than leaving callers to branch", () => {
    const c = polymarketConstraints()
    expect(f(c.maxLeverage)).toBe("1")
    expect(c.supportsShort).toBe(false)
    expect(c.supportsReduceOnly).toBe(false)
    expect(f(c.sizeLot)).toBe("0.000001")
    expect(f(c.priceTick)).toBe("0.001")
    expect(f(c.minNotional)).toBe("1")
  })

  it("reports the per-market tick when one has been observed", () => {
    expect(f(polymarketConstraints(COARSE).priceTick)).toBe("0.01")
  })
})

describe("price rounding direction", () => {
  it("rounds a buy limit down, away from the ask", () => {
    const q = quantizePolymarketOrder("buy", d("0.6157"), d("100"))
    expect(f(q.price!)).toBe("0.615")
  })

  it("rounds a sell limit up, away from the bid", () => {
    const q = quantizePolymarketOrder("sell", d("0.6151"), d("100"))
    expect(f(q.price!)).toBe("0.616")
  })

  it("leaves a price already on the tick alone, on either side", () => {
    expect(f(quantizePolymarketOrder("buy", d("0.615"), d("100")).price!)).toBe("0.615")
    expect(f(quantizePolymarketOrder("sell", d("0.615"), d("100")).price!)).toBe("0.615")
  })

  it("uses the market's own tick, not the venue default", () => {
    // 0.6157 is a valid price on a 0.001-tick market and a rejected one on a
    // 0.01-tick market. Quantizing to the default here is how an order gets
    // silently refused on a quarter of the venue's markets.
    expect(f(quantizePolymarketOrder("buy", d("0.6157"), d("100"), COARSE).price!)).toBe("0.61")
    expect(f(quantizePolymarketOrder("sell", d("0.6157"), d("100"), COARSE).price!)).toBe("0.62")
  })

  it("never rounds toward the other side, for any price or tick", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999_999 }),
        fc.constantFrom("0.001", "0.01", "0.0001"),
        fc.constantFrom("buy", "sell"),
        (thousandths, tick, side) => {
          const price = money.fromBigInt(BigInt(thousandths), 6)
          const q = quantizePolymarketOrder(
            side as "buy" | "sell",
            price,
            d("1000"),
            { priceTick: d(tick), minOrderShares: MIN_ORDER_SHARES },
          )
          const rounded = q.price!
          return side === "buy" ? money.lte(rounded, price) : money.gte(rounded, price)
        },
      ),
      { numRuns: 400 },
    )
  })
})

describe("size rounding", () => {
  it("truncates toward zero at 6dp", () => {
    expect(f(quantizePolymarketOrder("buy", d("0.5"), d("12.3456789")).size)).toBe("12.345678")
  })

  it("never rounds a size up, for any size", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 14n }), (mantissa) => {
        const size = money.fromBigInt(mantissa, 9)
        const q = quantizePolymarketOrder("buy", d("0.5"), size)
        return money.lte(q.size, size)
      }),
      { numRuns: 400 },
    )
  })

  it("keeps a size that is already a whole lot, carrying the lot's scale", () => {
    // Scale is part of the value: a size always comes back at the venue's 6dp,
    // so it round-trips through parse() and reaches the wire unambiguously.
    expect(f(quantizePolymarketOrder("buy", d("0.5"), d("40")).size)).toBe("40.000000")
  })
})

describe("belowMinimum — skip, do not submit", () => {
  it("is false for an order comfortably over both floors", () => {
    const q = quantizePolymarketOrder("buy", d("0.5"), d("100"))
    expect(q.belowMinimum).toBe(false)
  })

  it("is true under the venue's 5-share floor", () => {
    // Verified live: every sampled market reports min_order_size 5.
    expect(quantizePolymarketOrder("buy", d("0.5"), d("4.999999")).belowMinimum).toBe(true)
    expect(quantizePolymarketOrder("buy", d("0.5"), MIN_ORDER_SHARES).belowMinimum).toBe(false)
  })

  it("is true when truncation is what pushed it under the floor", () => {
    // 5 shares exactly clears the floor; a size that truncates to 4.999999
    // does not, and the caller must be told before it submits.
    const q = quantizePolymarketOrder("buy", d("0.5"), d("4.9999999"))
    expect(f(q.size)).toBe("4.999999")
    expect(q.belowMinimum).toBe(true)
  })

  it("is true when the notional lands under the minimum order value", () => {
    // 5 shares at 0.05 is $0.25 — over the share floor, under the value floor.
    expect(quantizePolymarketOrder("buy", d("0.05"), d("5")).belowMinimum).toBe(true)
    expect(f(MIN_ORDER_NOTIONAL)).toBe("1")
    // 20 shares at 0.05 is exactly $1.00, which is not below the minimum.
    expect(quantizePolymarketOrder("buy", d("0.05"), d("20")).belowMinimum).toBe(false)
  })

  it("is true for a zero size", () => {
    const q = quantizePolymarketOrder("buy", d("0.5"), d("0"))
    expect(f(q.size)).toBe("0.000000")
    expect(q.belowMinimum).toBe(true)
  })

  it("is true when a buy rounds out of the tradeable band instead of clamping up", () => {
    // 0.0005 floors to 0, which is not a price. Clamping it up to one tick
    // would buy at twice the intended price — the exact move the rounding
    // rule exists to forbid — so the order is refused instead.
    const q = quantizePolymarketOrder("buy", d("0.0005"), d("100"))
    expect(f(q.price!)).toBe("0.000")
    expect(q.belowMinimum).toBe(true)
  })

  it("is true when a sell rounds past certainty instead of clamping down", () => {
    const q = quantizePolymarketOrder("sell", d("0.9995"), d("100"))
    expect(f(q.price!)).toBe("1.000")
    expect(q.belowMinimum).toBe(true)
  })

  it("accepts the extremes of the band itself", () => {
    expect(quantizePolymarketOrder("buy", d("0.001"), d("5000")).belowMinimum).toBe(false)
    expect(quantizePolymarketOrder("sell", d("0.999"), d("100")).belowMinimum).toBe(false)
  })
})

describe("market orders", () => {
  it("carry no price but still face the size floors", () => {
    const big = quantizePolymarketOrder("buy", null, d("100.1234567"))
    expect(big.price).toBeNull()
    expect(f(big.size)).toBe("100.123456")
    expect(big.belowMinimum).toBe(false)

    const small = quantizePolymarketOrder("buy", null, d("1"))
    expect(small.belowMinimum).toBe(true)
  })
})

describe("caller bugs throw rather than coerce", () => {
  it("rejects a negative size", () => {
    expect(() => quantizePolymarketOrder("buy", d("0.5"), d("-1"))).toThrow(RangeError)
  })

  it("rejects a negative price", () => {
    expect(() => quantizePolymarketOrder("buy", d("-0.5"), d("100"))).toThrow(RangeError)
  })

  it("rejects a non-positive tick", () => {
    expect(() =>
      quantizePolymarketOrder("buy", d("0.5"), d("100"), {
        priceTick: d("0"),
        minOrderShares: MIN_ORDER_SHARES,
      }),
    ).toThrow(RangeError)
  })
})

describe("constants match the live venue", () => {
  it("defaults to the finest tick the venue quotes", () => {
    expect(f(PRICE_TICK_DEFAULT)).toBe("0.001")
    expect(f(DEFAULT_MARKET_RULES.priceTick)).toBe("0.001")
  })

  it("sizes to USDC's 6 decimals", () => {
    expect(f(SIZE_LOT)).toBe("0.000001")
  })
})
