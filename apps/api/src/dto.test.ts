import { describe, it, expect } from "vitest";

import {
  toTokenDTO,
  toTrendingTokenDTO,
  toTradeDTO,
  toHolderDTO,
  toCandleDTO,
  pageMeta,
  progressBps,
  fraction,
  priceFloat,
  CANDLE_INTERVALS,
  type TokenRow,
  type TradeRow,
  type CandleRow,
} from "./dto.js";

const baseToken: TokenRow = {
  address: "0xtoken",
  creator: "0xcreator",
  name: "Meme",
  symbol: "MEME",
  metadataUri: "ipfs://QmMeta",
  totalSupply: 1_000_000_000n * 10n ** 18n,
  maxSupplyForSale: 800_000_000n * 10n ** 18n,
  lpSupply: 200_000_000n * 10n ** 18n,
  fundingGoal: 30n * 10n ** 18n,
  virtualEthReserve: 10n * 10n ** 18n,
  virtualTokenReserve: 1_073_000_000n * 10n ** 18n,
  tradeFeeBps: 100,
  creatorFeeShareBps: 5000,
  graduationFeeBps: 100,
  realEthRaised: 15n * 10n ** 18n,
  tokensSold: 400_000_000n * 10n ** 18n,
  currentPriceX18: 25_000_000_000n,
  marketCap: 25_000_000_000n * 1_000_000_000n,
  graduated: false,
  pair: null,
  tradeCount: 42,
  volumeNative: 20n * 10n ** 18n,
  lastTradeAt: 1_700_000_000n,
  createdAtBlock: 100n,
  createdAtTx: "0xtx",
  createdAt: 1_699_990_000n,
};

describe("dto helpers", () => {
  it("progressBps caps at 10000 and handles zero goal", () => {
    expect(progressBps(0n, 30n * 10n ** 18n)).toBe(0);
    expect(progressBps(15n * 10n ** 18n, 30n * 10n ** 18n)).toBe(5000);
    expect(progressBps(60n * 10n ** 18n, 30n * 10n ** 18n)).toBe(10_000); // capped
    expect(progressBps(5n, 0n)).toBe(0); // zero goal → 0
  });

  it("fraction returns 0..1 and handles zero whole", () => {
    expect(fraction(0n, 100n)).toBe(0);
    expect(fraction(25n, 100n)).toBe(0.25);
    expect(fraction(100n, 100n)).toBe(1);
    expect(fraction(10n, 0n)).toBe(0);
  });

  it("priceFloat converts priceX18 to a JS float", () => {
    expect(priceFloat(10n ** 18n)).toBe(1);
    expect(priceFloat(10n ** 9n)).toBeCloseTo(1e-9, 18);
  });

  it("CANDLE_INTERVALS covers the standard set", () => {
    expect(CANDLE_INTERVALS["1m"]).toBe(60);
    expect(CANDLE_INTERVALS["1d"]).toBe(86_400);
  });
});

describe("toTokenDTO", () => {
  it("emits bigints as strings, computes priceNative + progressBps, and falls back to a pending metadata block", () => {
    const dto = toTokenDTO(baseToken);
    expect(dto.address).toBe("0xtoken");
    expect(dto.decimals).toBe(18);
    expect(dto.totalSupply).toBe((1_000_000_000n * 10n ** 18n).toString());
    expect(typeof dto.realEthRaised).toBe("string");
    expect(typeof dto.priceNative).toBe("number");
    expect(dto.progressBps).toBe(5000);
    expect(dto.metadata.status).toBe("pending");
    expect(dto.metadata.tags).toEqual([]);
    expect(dto.lastTradeAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO date
  });

  it("joins resolved metadata when present", () => {
    const dto = toTokenDTO(baseToken, {
      status: "ok",
      description: "best coin",
      imageUrl: "https://gateway/ipfs/QmImg",
      bannerUrl: null,
      website: "https://meme.lol",
      twitter: null,
      telegram: null,
      discord: null,
      tags: ["meme", "dog"],
    });
    expect(dto.metadata.status).toBe("ok");
    expect(dto.metadata.description).toBe("best coin");
    expect(dto.metadata.tags).toEqual(["meme", "dog"]);
  });
});

describe("toTradeDTO", () => {
  it("maps a trade row, emitting amounts as strings and timestamp as ISO", () => {
    const row: TradeRow = {
      id: "0xtx-0",
      token: "0xtoken",
      trader: "0xbob",
      isBuy: true,
      ethAmount: 1n * 10n ** 18n,
      tokenAmount: 1_000n * 10n ** 18n,
      feeAmount: 10n ** 16n,
      source: "curve",
      priceX18: 10n ** 15n,
      realEthRaised: 5n * 10n ** 18n,
      tokensSold: 100n * 10n ** 18n,
      blockNumber: 123n,
      logIndex: 4,
      txHash: "0xtx",
      timestamp: 1_700_000_000n,
    };
    const dto = toTradeDTO(row);
    expect(dto.ethAmount).toBe("1000000000000000000");
    expect(dto.priceNative).toBeCloseTo(1e-3, 9);
    expect(dto.timestamp).toMatch(/^2023-/);
    expect(dto.isBuy).toBe(true);
    expect(dto.source).toBe("curve");
  });
});

describe("toHolderDTO", () => {
  it("computes a fractional pct", () => {
    const totalSupply = 1_000_000n * 10n ** 18n;
    const dto = toHolderDTO("0xholder", 25_000n * 10n ** 18n, totalSupply);
    expect(dto.pct).toBeCloseTo(0.025, 9);
  });
});

describe("toCandleDTO", () => {
  it("converts a candle row to numbers (TradingView-friendly)", () => {
    const row: CandleRow = {
      bucketStart: 1_700_000_000n,
      open: 10n ** 9n,
      high: 11n ** 9n,
      low: 9n ** 9n,
      close: 10n ** 9n,
      volume: 5n * 10n ** 18n,
      trades: 3,
    };
    const dto = toCandleDTO(row);
    expect(dto.time).toBe(1_700_000_000);
    expect(typeof dto.open).toBe("number");
    expect(dto.volume).toBe(5);
    expect(dto.trades).toBe(3);
  });
});

describe("toTrendingTokenDTO", () => {
  it("includes volume24h and priceChange24hBps", () => {
    const dto = toTrendingTokenDTO(baseToken, null, 5n * 10n ** 18n, 78);
    expect(dto.volume24h).toBe((5n * 10n ** 18n).toString());
    expect(dto.priceChange24hBps).toBe(78);
    expect(dto.address).toBe("0xtoken");
  });
});

describe("pageMeta", () => {
  it("derives totalPages / hasNext / hasPrev", () => {
    const m = pageMeta(57, 2, 10);
    expect(m).toEqual({ total: 57, page: 2, limit: 10, totalPages: 6, hasNextPage: true, hasPrevPage: true });
  });
  it("handles empty result sets", () => {
    expect(pageMeta(0, 1, 10).totalPages).toBe(0);
  });
});
