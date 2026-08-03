/**
 * API DTOs from `backend/packages/api/src/dto.ts`. uint256 amounts arrive as
 * decimal strings (lossless); the frontend `formatEther` / `BigInt`s them as
 * needed. Timestamps are ISO 8601 strings. priceNative / progressBps /
 * priceChange24hBps are plain numbers.
 */

export type Address = `0x${string}`;

export type MetadataStatus = "pending" | "ok" | "failed" | "unavailable";

export interface TokenMetadata {
  status: MetadataStatus;
  description: string | null;
  imageUrl: string | null;
  bannerUrl: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  discord: string | null;
  tags: string[];
}

export interface Token {
  address: Address;
  creator: Address;
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
  pair: Address | null;
  progressBps: number;
  tradeCount: number;
  volumeNative: string;
  lastTradeAt: string | null;
  createdAt: string;
  createdAtBlock: string;
  createdAtTx: string;
  metadata: TokenMetadata;
}

export type TokenListItem = Token & {
  /** wei, last-24h trading volume */
  volume24h: string;
};

/** Homepage trending carousel (`GET /v1/tokens/trending`). */
export type TrendingToken = TokenListItem & {
  priceChange24hBps: number;
};

export type TokenDetail = Token & {
  volume24h: string;
  volumeTotal: string;
  priceChange24hBps: number;
  holderCount: number;
};

export type TradeSource = "curve" | "dex";

export interface Trade {
  id: string;
  token: Address;
  trader: Address;
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
  txHash: `0x${string}`;
  timestamp: string;
}

export interface Holder {
  address: Address;
  balance: string;
  /** Fraction of total supply, e.g. 0.0125 = 1.25%. */
  pct: number;
}

export interface HoldersResponse {
  token: Address;
  totalSupply: string;
  data: Holder[];
}

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

export interface CandlesResponse {
  interval: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
  data: Bar[];
}

/** Realtime payloads from the socket.io feed. */
export interface TradeEventPayload {
  token: Address;
  trade: Trade;
  tokenDTO: Token;
}
export interface TokenUpdatePayload {
  address: Address;
  priceX18: string;
  priceNative: number;
  marketCap: string;
  realEthRaised: string;
  tokensSold: string;
  progressBps: number;
  graduated: boolean;
  lastTradeAt: string | null;
}
export interface TokenGraduatedPayload {
  token: Address;
  pair: Address;
  ethToLp: string;
  tokensToLp: string;
  tokensBurned: string;
  degradedPath: boolean;
  txHash: `0x${string}`;
  blockNumber: string;
  timestamp: string;
}
export interface StatusPayload {
  indexedBlock: string;
  headBlock: string | null;
  lag: number | null;
  isSynced: boolean | null;
  chainId: number | null;
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
