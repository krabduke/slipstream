/**
 * W6 — fixtures for the Hyperliquid adapter tests.
 *
 * Every number here was copied out of a live `POST /info` response on
 * 2026-08-29, not invented. That matters: a fixture that agrees with the code
 * but not with the venue proves nothing. The provenance of each block is noted
 * so a later reader can re-fetch and diff it.
 */
import type {
  ClearinghouseStateResponse,
  ExtraAgentsResponse,
  L2BookResponse,
  MetaResponse,
  SpotMetaResponse,
  UserFillsResponse,
  UserRateLimitResponse,
} from "@nktkas/hyperliquid/api/info"
import type { HyperliquidInfo } from "../read.js"

/** From `{"type":"meta"}` — first four entries plus a delisted one. */
export const META: MetaResponse = {
  universe: [
    { szDecimals: 5, name: "BTC", maxLeverage: 40, marginTableId: 56 },
    { szDecimals: 4, name: "ETH", maxLeverage: 25, marginTableId: 55 },
    { szDecimals: 2, name: "ATOM", maxLeverage: 5, marginTableId: 5 },
    { szDecimals: 0, name: "DOGE", maxLeverage: 10, marginTableId: 10 },
    { szDecimals: 1, name: "MATIC", maxLeverage: 20, marginTableId: 20, isDelisted: true },
  ],
  marginTables: [],
  collateralToken: 0,
}

/** From `{"type":"spotMeta"}` — the canonical pair plus the two extremes. */
export const SPOT_META: SpotMetaResponse = {
  universe: [
    { tokens: [1, 0], name: "PURR/USDC", index: 0, isCanonical: true },
    // HYPE/USDC. Base szDecimals 2.
    { tokens: [3, 0], name: "@107", index: 107, isCanonical: false },
    // RUB/USDC. Base szDecimals 5; rests at 117667.0 — six significant figures.
    { tokens: [4, 0], name: "@173", index: 173, isCanonical: false },
    // HREKT/USDC. Base szDecimals 0; rests at 0.00000011 — eight decimals.
    { tokens: [5, 0], name: "@201", index: 201, isCanonical: false },
  ],
  tokens: [
    token(0, "USDC", 8),
    token(1, "PURR", 0),
    token(2, "HFUN", 2),
    token(3, "HYPE", 2),
    token(4, "RUB", 5),
    token(5, "HREKT", 0),
  ],
}

function token(index: number, name: string, szDecimals: number): SpotMetaResponse["tokens"][number] {
  return {
    name,
    szDecimals,
    weiDecimals: 8,
    index,
    tokenId: `0x${index.toString(16).padStart(32, "0")}`,
    isCanonical: index <= 1,
    evmContract: null,
    fullName: null,
    deployerTradingFeeShare: "0.0",
  }
}

/** From `{"type":"clearinghouseState","user":"0xf191…f2ef"}`. */
export const CLEARINGHOUSE_STATE: ClearinghouseStateResponse = {
  marginSummary: {
    accountValue: "93850.703727",
    totalNtlPos: "848087.6049",
    totalRawUsd: "858731.308627",
    totalMarginUsed: "30354.132622",
  },
  crossMarginSummary: {
    accountValue: "93850.703727",
    totalNtlPos: "848087.6049",
    totalRawUsd: "858731.308627",
    totalMarginUsed: "30354.132622",
  },
  crossMaintenanceMarginUsed: "10601.095061",
  withdrawable: "9041.943237",
  assetPositions: [
    position("BTC", "-5.99995", "75999.4", "467408.1049", "-11415.33054", 40, "107161.0167177731"),
    position("ETH", "-100.0", "1926.56", "244522.0", "-51865.2335", 25, "4187.838091402"),
    position("SOL", "-900.0", "77.2261", "94554.0", "-25050.50346", 20, "297.7397239274"),
    // Live example of a position the venue cannot liquidate: liquidationPx null.
    position("HYPE", "500.0", "38.8485", "41603.5", "22179.246025", 10, null),
  ],
  time: 1788019610170,
}

function position(
  coin: string,
  szi: string,
  entryPx: string,
  positionValue: string,
  unrealizedPnl: string,
  leverage: number,
  liquidationPx: string | null,
): ClearinghouseStateResponse["assetPositions"][number] {
  return {
    type: "oneWay",
    position: {
      coin,
      szi,
      leverage: { type: "cross", value: leverage },
      entryPx,
      positionValue,
      unrealizedPnl,
      returnOnEquity: "0.0",
      liquidationPx,
      marginUsed: "0.0",
      maxLeverage: leverage,
      cumFunding: { allTime: "0.0", sinceOpen: "0.0", sinceChange: "0.0" },
    },
  }
}

/** From `{"type":"l2Book","coin":"BTC"}`, truncated to four levels a side. */
export const BTC_BOOK: L2BookResponse = {
  coin: "BTC",
  time: 1788019624369,
  levels: [
    [
      { px: "77902.0", sz: "4.41798", n: 20 },
      { px: "77901.0", sz: "0.01667", n: 8 },
      { px: "77900.0", sz: "0.02074", n: 5 },
      { px: "77899.0", sz: "0.06122", n: 4 },
    ],
    [
      { px: "77903.0", sz: "1.11111", n: 3 },
      { px: "77904.0", sz: "2.22222", n: 4 },
      { px: "77905.0", sz: "3.33333", n: 5 },
      { px: "77906.0", sz: "4.44444", n: 6 },
    ],
  ],
}

/** From `{"type":"userFills","user":"0x8c62…c974"}`. */
export const USER_FILLS: UserFillsResponse = [
  {
    coin: "@107",
    px: "55.462",
    sz: "2.94",
    side: "A",
    time: 1785307090387,
    startPosition: "2.95067411",
    dir: "Sell",
    closedPnl: "-0.49093446",
    hash: `0x${"8f".repeat(32)}`,
    oid: 505016273138,
    crossed: true,
    fee: "0.05217864",
    tid: 678999364071316,
    feeToken: "USDC",
    twapId: null,
  },
  {
    coin: "BTC",
    px: "77902.0",
    sz: "0.01",
    side: "B",
    time: 1785307190387,
    startPosition: "0.0",
    dir: "Open Long",
    closedPnl: "0.0",
    hash: `0x${"86".repeat(32)}`,
    oid: 503564929848,
    crossed: false,
    fee: "0.1",
    // A builder-fee fill: the cost of the fill is both charges.
    builderFee: "0.02",
    tid: 178254281564941,
    feeToken: "USDC",
    twapId: null,
  },
]

/** From `{"type":"userRateLimit","user":"0xf191…f2ef"}`. */
export const RATE_LIMIT: UserRateLimitResponse = {
  cumVlm: "30983579.6400000006",
  nRequestsUsed: 16083,
  nRequestsCap: 30993579,
  nRequestsSurplus: 0,
}

export const OWNER = `0x${"a1".repeat(20)}`
export const SIGNER = `0x${"b2".repeat(20)}`
export const STRANGER = `0x${"c3".repeat(20)}`

export const AGENTS: ExtraAgentsResponse = [
  { address: SIGNER as `0x${string}`, name: "slipstream", validUntil: null },
]

/**
 * A `/info` client that answers from fixtures and records what it was asked.
 * Overrides replace one method; anything not overridden still answers, so a test
 * only states the part it cares about.
 */
export const fakeInfo = (
  overrides: Partial<HyperliquidInfo> = {},
): HyperliquidInfo & { readonly calls: string[] } => {
  const calls: string[] = []
  const base: HyperliquidInfo = {
    meta: async () => {
      calls.push("meta")
      return META
    },
    spotMeta: async () => {
      calls.push("spotMeta")
      return SPOT_META
    },
    l2Book: async () => {
      calls.push("l2Book")
      return BTC_BOOK
    },
    clearinghouseState: async () => {
      calls.push("clearinghouseState")
      return CLEARINGHOUSE_STATE
    },
    userFillsByTime: async () => {
      calls.push("userFillsByTime")
      return USER_FILLS
    },
    extraAgents: async () => {
      calls.push("extraAgents")
      return AGENTS
    },
    userRateLimit: async () => {
      calls.push("userRateLimit")
      return RATE_LIMIT
    },
  }
  return { ...base, ...overrides, calls }
}
