import { onchainTable, primaryKey, index } from "ponder";

/**
 * Canonical, chain-derived data. Ponder owns these tables and exposes stable
 * read views in the `public` schema; the @lcai/api service reads them (and
 * imports these table objects for type-safe queries) but never writes to them.
 *
 * All monetary / token amounts are `bigint` (uint256 wei). Timestamps are unix
 * seconds (`bigint`). Prices are `priceX18` = native wei per 1e18 token-wei.
 */

export const token = onchainTable(
  "tokens",
  (t) => ({
    address: t.hex().primaryKey(), // the ERC20 token address
    creator: t.hex().notNull(),
    name: t.text().notNull(),
    symbol: t.text().notNull(),
    metadataUri: t.text().notNull(),

    // curve config snapshotted at launch (immutable for the life of the curve)
    totalSupply: t.bigint().notNull(),
    maxSupplyForSale: t.bigint().notNull(),
    lpSupply: t.bigint().notNull(),
    fundingGoal: t.bigint().notNull(),
    virtualEthReserve: t.bigint().notNull(),
    virtualTokenReserve: t.bigint().notNull(),
    tradeFeeBps: t.integer().notNull(),
    creatorFeeShareBps: t.integer().notNull(),
    graduationFeeBps: t.integer().notNull(),

    // live curve state (updated from Trade / Graduated events)
    realEthRaised: t.bigint().notNull(),
    tokensSold: t.bigint().notNull(),
    currentPriceX18: t.bigint().notNull(),
    marketCap: t.bigint().notNull(), // currentPriceX18 * totalSupply / 1e18
    graduated: t.boolean().notNull(),
    pair: t.hex(), // DEX pair, null until graduation

    // cheap rolling aggregates (time-windowed ones are computed at query time)
    tradeCount: t.integer().notNull(),
    volumeNative: t.bigint().notNull(), // cumulative curve-side native volume
    lastTradeAt: t.bigint(), // unix seconds, null if no trades yet

    // provenance
    createdAtBlock: t.bigint().notNull(),
    createdAtTx: t.hex().notNull(),
    createdAt: t.bigint().notNull(), // unix seconds
  }),
  (table) => ({
    byCreator: index().on(table.creator),
    byCreatedAt: index().on(table.createdAt),
    byMarketCap: index().on(table.marketCap),
    byLastTradeAt: index().on(table.lastTradeAt),
  }),
);

export const trade = onchainTable(
  "trades",
  (t) => ({
    id: t.text().primaryKey(), // `${txHash}-${logIndex}`
    token: t.hex().notNull(),
    trader: t.hex().notNull(),
    isBuy: t.boolean().notNull(),
    ethAmount: t.bigint().notNull(), // curve-side native moved (excl. fee)
    tokenAmount: t.bigint().notNull(),
    feeAmount: t.bigint().notNull(),
    source: t.text().notNull(), // 'curve' | 'dex'
    priceX18: t.bigint().notNull(),
    realEthRaised: t.bigint().notNull(), // curve state after this trade
    tokensSold: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    logIndex: t.integer().notNull(),
    txHash: t.hex().notNull(),
    timestamp: t.bigint().notNull(), // unix seconds
  }),
  (table) => ({
    byTokenTime: index().on(table.token, table.timestamp),
    byTokenBlock: index().on(table.token, table.blockNumber, table.logIndex),
    byTrader: index().on(table.trader),
    byTime: index().on(table.timestamp),
  }),
);

export const graduation = onchainTable(
  "graduations",
  (t) => ({
    token: t.hex().primaryKey(),
    pair: t.hex().notNull(),
    weth: t.hex().notNull(), // router WETH at graduation time
    sourceIsToken0: t.boolean().notNull(), // source token is pair token0 (vs WETH token1)
    ethToLp: t.bigint().notNull(),
    tokensToLp: t.bigint().notNull(),
    tokensBurned: t.bigint().notNull(),
    degradedPath: t.boolean().notNull(),
    blockNumber: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    byTime: index().on(table.timestamp),
    byPair: index().on(table.pair),
  }),
);

export const holder = onchainTable(
  "holders",
  (t) => ({
    token: t.hex().notNull(),
    address: t.hex().notNull(),
    balance: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.token, table.address] }),
    byTokenBalance: index().on(table.token, table.balance),
  }),
);

/**
 * OHLCV candlesticks, maintained incrementally on each Trade (Ponder time-series
 * pattern). One row per (token, interval-in-seconds, bucketStart-unix-seconds).
 * `volume` is the sum of curve-side native amounts.
 */
export const candle = onchainTable(
  "candles",
  (t) => ({
    token: t.hex().notNull(),
    interval: t.integer().notNull(), // seconds: 60 | 300 | 900 | 3600 | 14400 | 86400
    bucketStart: t.bigint().notNull(), // unix seconds, floored to the interval
    open: t.bigint().notNull(),
    high: t.bigint().notNull(),
    low: t.bigint().notNull(),
    close: t.bigint().notNull(),
    volume: t.bigint().notNull(),
    trades: t.integer().notNull(),
  }),
  (table) => ({
    pk: primaryKey({
      columns: [table.token, table.interval, table.bucketStart],
    }),
    byLookup: index().on(table.token, table.interval, table.bucketStart),
  }),
);

/**
 * Off-chain-derived token metadata (IPFS JSON: image, banner, socials, tags …).
 * Indexer inserts a row with `status='pending'` on TokenLaunched; the API process
 * runs a background resolver that fetches the IPFS JSON, validates it with Zod,
 * and updates this row to `status='ok'` (or 'failed' / 'unavailable' after retries).
 *
 * Notes:
 *  - This is declared as an `onchainTable` so the schema travels with the indexer
 *    package (single source of truth for the API). Ponder will reset this table
 *    on a full reindex; that is acceptable because the data is fully re-derivable
 *    from IPFS and the resolver is idempotent.
 *  - The API process writes to this table via its own drizzle handle (Ponder's
 *    `context.db.insert` API only accepts writes from indexing functions, but
 *    the underlying Postgres table is just a regular table — drizzle from the
 *    API process is fine).
 */
export const tokenMetadata = onchainTable(
  "token_metadata",
  (t) => ({
    token: t.hex().primaryKey(),
    metadataUri: t.text().notNull(),
    status: t.text().notNull(), // 'pending' | 'ok' | 'failed' | 'unavailable'
    description: t.text(),
    imageUrl: t.text(),
    bannerUrl: t.text(),
    website: t.text(),
    twitter: t.text(),
    telegram: t.text(),
    discord: t.text(),
    tags: t.jsonb().$type<string[]>(),
    raw: t.jsonb(),
    attempts: t.integer().notNull(),
    nextAttemptAt: t.bigint(), // unix seconds; null = ready now
    error: t.text(),
    resolvedAt: t.bigint(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    byStatus: index().on(table.status),
    byNextAttempt: index().on(table.nextAttemptAt),
  }),
);
