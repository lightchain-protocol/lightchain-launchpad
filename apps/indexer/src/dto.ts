/**
 * Indexer-side DTO mappers — kept in sync with packages/api/src/dto.ts. The
 * indexer publishes these shapes via pg_notify so the API can fan them out
 * to SSE subscribers without re-reading the database on every event.
 *
 * Duplication accepted (~150 lines, low churn). If divergence ever becomes a
 * problem, extract a `packages/shared/` workspace package.
 */

const WAD = 10n ** 18n;
const BPS = 10_000n;

const sReq = (v: bigint): string => v.toString();
const iso = (unixSeconds: bigint | null | undefined): string | null =>
  unixSeconds == null ? null : new Date(Number(unixSeconds) * 1000).toISOString();

export const priceFloat = (priceX18: bigint): number => Number(priceX18) / 1e18;
export const progressBps = (realEthRaised: bigint, fundingGoal: bigint): number => {
  if (fundingGoal === 0n) return 0;
  const bps = (realEthRaised * BPS) / fundingGoal;
  return Number(bps > BPS ? BPS : bps);
};

export interface TokenRow {
  address: string;
  creator: string;
  name: string;
  symbol: string;
  metadataUri: string;
  totalSupply: bigint;
  maxSupplyForSale: bigint;
  lpSupply: bigint;
  fundingGoal: bigint;
  virtualEthReserve: bigint;
  virtualTokenReserve: bigint;
  tradeFeeBps: number;
  creatorFeeShareBps: number;
  graduationFeeBps: number;
  realEthRaised: bigint;
  tokensSold: bigint;
  currentPriceX18: bigint;
  marketCap: bigint;
  graduated: boolean;
  pair: string | null;
  tradeCount: number;
  volumeNative: bigint;
  lastTradeAt: bigint | null;
  createdAtBlock: bigint;
  createdAtTx: string;
  createdAt: bigint;
}

export interface TokenDTO {
  address: string;
  creator: string;
  name: string;
  symbol: string;
  decimals: 18;
  metadataUri: string;
  totalSupply: string;
  maxSupplyForSale: string;
  lpSupply: string;
  fundingGoal: string;
  virtualEthReserve: string;
  virtualTokenReserve: string;
  tradeFeeBps: number;
  creatorFeeShareBps: number;
  graduationFeeBps: number;
  realEthRaised: string;
  tokensSold: string;
  currentPriceX18: string;
  priceNative: number;
  marketCap: string;
  graduated: boolean;
  pair: string | null;
  progressBps: number;
  tradeCount: number;
  volumeNative: string;
  lastTradeAt: string | null;
  createdAt: string;
  createdAtBlock: string;
  createdAtTx: string;
  metadata: {
    status: "pending" | "ok" | "failed" | "unavailable";
    description: string | null;
    imageUrl: string | null;
    bannerUrl: string | null;
    website: string | null;
    twitter: string | null;
    telegram: string | null;
    discord: string | null;
    tags: string[];
  };
}

export function toTokenDTO(t: TokenRow): TokenDTO {
  return {
    address: t.address,
    creator: t.creator,
    name: t.name,
    symbol: t.symbol,
    decimals: 18,
    metadataUri: t.metadataUri,
    totalSupply: sReq(t.totalSupply),
    maxSupplyForSale: sReq(t.maxSupplyForSale),
    lpSupply: sReq(t.lpSupply),
    fundingGoal: sReq(t.fundingGoal),
    virtualEthReserve: sReq(t.virtualEthReserve),
    virtualTokenReserve: sReq(t.virtualTokenReserve),
    tradeFeeBps: t.tradeFeeBps,
    creatorFeeShareBps: t.creatorFeeShareBps,
    graduationFeeBps: t.graduationFeeBps,
    realEthRaised: sReq(t.realEthRaised),
    tokensSold: sReq(t.tokensSold),
    currentPriceX18: sReq(t.currentPriceX18),
    priceNative: priceFloat(t.currentPriceX18),
    marketCap: sReq(t.marketCap),
    graduated: t.graduated,
    pair: t.pair,
    progressBps: progressBps(t.realEthRaised, t.fundingGoal),
    tradeCount: t.tradeCount,
    volumeNative: sReq(t.volumeNative),
    lastTradeAt: iso(t.lastTradeAt),
    createdAt: iso(t.createdAt)!,
    createdAtBlock: sReq(t.createdAtBlock),
    createdAtTx: t.createdAtTx,
    metadata: {
      status: "pending",
      description: null,
      imageUrl: null,
      bannerUrl: null,
      website: null,
      twitter: null,
      telegram: null,
      discord: null,
      tags: [],
    },
  };
}

export type TradeSource = "curve" | "dex";

export interface TradeRow {
  id: string;
  token: string;
  trader: string;
  isBuy: boolean;
  ethAmount: bigint;
  tokenAmount: bigint;
  feeAmount: bigint;
  source: TradeSource;
  priceX18: bigint;
  realEthRaised: bigint;
  tokensSold: bigint;
  blockNumber: bigint;
  logIndex: number;
  txHash: string;
  timestamp: bigint;
}
export interface TradeDTO {
  id: string;
  token: string;
  trader: string;
  isBuy: boolean;
  ethAmount: string;
  tokenAmount: string;
  feeAmount: string;
  source: TradeSource;
  priceX18: string;
  priceNative: number;
  realEthRaised: string;
  tokensSold: string;
  blockNumber: string;
  logIndex: number;
  txHash: string;
  timestamp: string;
}
export function toTradeDTO(r: TradeRow): TradeDTO {
  return {
    id: r.id,
    token: r.token,
    trader: r.trader,
    isBuy: r.isBuy,
    ethAmount: sReq(r.ethAmount),
    tokenAmount: sReq(r.tokenAmount),
    feeAmount: sReq(r.feeAmount),
    source: r.source,
    priceX18: sReq(r.priceX18),
    priceNative: priceFloat(r.priceX18),
    realEthRaised: sReq(r.realEthRaised),
    tokensSold: sReq(r.tokensSold),
    blockNumber: sReq(r.blockNumber),
    logIndex: r.logIndex,
    txHash: r.txHash,
    timestamp: iso(r.timestamp)!,
  };
}

export interface GraduationDTO {
  token: string;
  pair: string;
  ethToLp: string;
  tokensToLp: string;
  tokensBurned: string;
  degradedPath: boolean;
  txHash: string;
  blockNumber: string;
  timestamp: string;
}

export interface TokenUpdatePayload {
  address: string;
  priceX18: string;
  priceNative: number;
  marketCap: string;
  realEthRaised: string;
  tokensSold: string;
  progressBps: number;
  graduated: boolean;
  lastTradeAt: string | null;
}

export function tokenUpdateFromDTO(t: TokenDTO): TokenUpdatePayload {
  return {
    address: t.address,
    priceX18: t.currentPriceX18,
    priceNative: t.priceNative,
    marketCap: t.marketCap,
    realEthRaised: t.realEthRaised,
    tokensSold: t.tokensSold,
    progressBps: t.progressBps,
    graduated: t.graduated,
    lastTradeAt: t.lastTradeAt,
  };
}

/**
 * Heuristic: Ponder 0.9 doesn't expose an `event.isRealtime` flag, so we treat
 * any event whose block timestamp is within ~60 s of wall clock as "realtime".
 * Backfilled blocks have older timestamps (hours/days/years), so the false-
 * positive rate is negligible. If the indexer ever falls more than 60 s behind,
 * realtime emits will be paused until it catches up — acceptable trade-off.
 */
export function isRealtimeEvent(blockTimestamp: bigint): boolean {
  const nowSec = Math.floor(Date.now() / 1000);
  return nowSec - Number(blockTimestamp) < 60;
}
