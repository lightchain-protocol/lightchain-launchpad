/**
 * API DTOs and mappers from the DB rows. Convention:
 *   - uint256 amounts → decimal strings (lossless; the frontend formats them)
 *   - small ints (bps, counts) → JS numbers
 *   - timestamps → ISO 8601 strings (input is unix seconds as bigint)
 *   - prices in candles → JS floats (native-per-token = priceX18 / 1e18)
 */
const WAD = 10n ** 18n;
const BPS = 10_000n;

const s = (v: bigint | null | undefined): string | null => (v == null ? null : v.toString());
const sReq = (v: bigint): string => v.toString();
const iso = (unixSeconds: bigint | null | undefined): string | null =>
  unixSeconds == null ? null : new Date(Number(unixSeconds) * 1000).toISOString();

/** native-per-token as a float, from a priceX18 value */
export const priceFloat = (priceX18: bigint): number => Number(priceX18) / 1e18;
/** progress toward graduation, in basis points (capped at 10000) */
export const progressBps = (realEthRaised: bigint, fundingGoal: bigint): number => {
  if (fundingGoal === 0n) return 0;
  const bps = (realEthRaised * BPS) / fundingGoal;
  return Number(bps > BPS ? BPS : bps);
};
export const fraction = (part: bigint, whole: bigint): number => {
  if (whole === 0n) return 0;
  return Number((part * 1_000_000_000n) / whole) / 1_000_000_000;
};

// --- input row shapes (subset of the Ponder mirror tables + the metadata join) ---
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
export interface MetadataRow {
  status: "pending" | "ok" | "failed" | "unavailable";
  description: string | null;
  imageUrl: string | null;
  bannerUrl: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  discord: string | null;
  tags: string[] | null;
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
    status: MetadataRow["status"];
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

export function toTokenDTO(t: TokenRow, m?: MetadataRow | null): TokenDTO {
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
      status: m?.status ?? "pending",
      description: m?.description ?? null,
      imageUrl: m?.imageUrl ?? null,
      bannerUrl: m?.bannerUrl ?? null,
      website: m?.website ?? null,
      twitter: m?.twitter ?? null,
      telegram: m?.telegram ?? null,
      discord: m?.discord ?? null,
      tags: m?.tags ?? [],
    },
  };
}

export interface TokenStats {
  volume24h: bigint;
  volumeTotal: bigint;
  priceChange24hBps: number;
  holderCount: number;
}
export type TokenDetailDTO = TokenDTO & {
  volume24h: string;
  volumeTotal: string;
  priceChange24hBps: number;
  holderCount: number;
};

export type TrendingTokenDTO = TokenDTO & {
  volume24h: string;
  priceChange24hBps: number;
};

export function toTrendingTokenDTO(
  t: TokenRow,
  m: MetadataRow | null | undefined,
  volume24h: bigint,
  priceChange24hBps: number,
): TrendingTokenDTO {
  return {
    ...toTokenDTO(t, m),
    volume24h: sReq(volume24h),
    priceChange24hBps,
  };
}

export function toTokenDetailDTO(t: TokenRow, m: MetadataRow | null | undefined, stats: TokenStats): TokenDetailDTO {
  return {
    ...toTokenDTO(t, m),
    volume24h: sReq(stats.volume24h),
    volumeTotal: sReq(stats.volumeTotal),
    priceChange24hBps: stats.priceChange24hBps,
    holderCount: stats.holderCount,
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

export interface HolderDTO {
  address: string;
  balance: string;
  pct: number;
}
export function toHolderDTO(address: string, balance: bigint, totalSupply: bigint): HolderDTO {
  return { address, balance: sReq(balance), pct: fraction(balance, totalSupply) };
}

export interface CandleRow {
  bucketStart: bigint;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  volume: bigint;
  trades: number;
}
export interface CandleDTO {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}
export function toCandleDTO(c: CandleRow): CandleDTO {
  return {
    time: Number(c.bucketStart),
    open: priceFloat(c.open),
    high: priceFloat(c.high),
    low: priceFloat(c.low),
    close: priceFloat(c.close),
    volume: Number(c.volume) / 1e18,
    trades: c.trades,
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

export interface GraduationRow {
  token: string;
  pair: string;
  ethToLp: bigint;
  tokensToLp: bigint;
  tokensBurned: bigint;
  degradedPath: boolean;
  txHash: string;
  blockNumber: bigint;
  timestamp: bigint;
}

export function toGraduationDTO(r: GraduationRow): GraduationDTO {
  return {
    token: r.token,
    pair: r.pair,
    ethToLp: sReq(r.ethToLp),
    tokensToLp: sReq(r.tokensToLp),
    tokensBurned: sReq(r.tokensBurned),
    degradedPath: r.degradedPath,
    txHash: r.txHash,
    blockNumber: sReq(r.blockNumber),
    timestamp: iso(r.timestamp)!,
  };
}

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}
export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}
export function pageMeta(total: number, page: number, limit: number): PageMeta {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

export const CANDLE_INTERVALS: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};
