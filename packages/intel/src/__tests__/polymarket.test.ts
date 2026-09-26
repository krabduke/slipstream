import { describe, expect, it } from "vitest"
import { cleanName, isShortHorizon } from "../polymarket.js"

describe("isShortHorizon", () => {
  it("catches 5- and 15-minute crypto up/down markets by slug or title", () => {
    expect(isShortHorizon({ slug: "btc-updown-5m-1776759600", title: "" })).toBe(true)
    expect(isShortHorizon({ slug: "btc-updown-15m-1774188000", title: "" })).toBe(true)
    expect(isShortHorizon({ slug: "x", title: "Bitcoin Up or Down - April 21, 4:20AM-4:25AM ET" })).toBe(true)
  })

  it("leaves ordinary markets alone, including daily ones", () => {
    expect(isShortHorizon({ slug: "highest-temperature-in-houston-on-september-27-2026-88-89f", title: "Highest temperature in Houston" })).toBe(false)
    expect(isShortHorizon({ slug: "fed-cuts-rates-in-october", title: "Will the Fed cut rates in October?" })).toBe(false)
    expect(isShortHorizon({ slug: "bitcoin-up-or-down-on-september-27", title: "Bitcoin Up or Down on September 27?" })).toBe(false)
  })
})

describe("cleanName", () => {
  it("drops Polymarket's default address-plus-timestamp usernames", () => {
    expect(cleanName("0x5966Db1fE50763C9e3C014d756369BAd07E1F804-1777648534241")).toBeNull()
    expect(cleanName("0x6e82b93eb57b01a63027bd0c6d2f3f04934a752c")).toBeNull()
    expect(cleanName("  swisstony ")).toBe("swisstony")
    expect(cleanName("")).toBeNull()
  })
})
