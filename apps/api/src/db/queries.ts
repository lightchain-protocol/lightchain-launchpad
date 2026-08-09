/**
 * Type-safe drizzle queries against Ponder's tables (+ tokenMetadata) using the
 * workspace-imported `@lcai/indexer/schema`. Every column reference is checked
 * at compile time; raw SQL is only used for the tiny correlated subqueries that
 * have no convenient query-builder equivalent.
 *
 * uint256 columns are stored as NUMERIC(78,0). Drizzle returns them as decimal
 * strings; we coerce to bigint with `bi()` at the boundary.
 */
import { and, asc, desc, eq, gt, inArray, lt, lte, gte, sql } from "drizzle-orm";

import { FETCH_TIMEOUT_MS } from "../services/ipfs.js";

// Pull tables in directly so the inferred types resolve via the workspace
// package path; ambient `tsc --declaration` doesn't need to invent a synthesised
// re-export path under `../../../indexer/node_modules/ponder/...`.
import {
  token as tokens,
  trade as trades,
  graduation as graduations,
  holder as holders,
  candle as candles,
  tokenMetadata,
} from "@lcai/indexer/schema";

import { db } from "./client.js";
import { config } from "../config.js";
import {
  type TokenRow,
  type MetadataRow,
  type TradeRow,
  type CandleRow,
  type TokenStats,
} from "../dto.js";

const LAUNCHPAD = config.LAUNCHPAD_ADDRESS.toLowerCase();
const DEAD = "0x000000000000000000000000000000000000dead";

const bi = (v: unknown): bigint => (v == null ? 0n : BigInt(String(v)));
const biNull = (v: unknown): bigint | null => (v == null ? null : BigInt(String(v)));
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const DAY = 86400;

/** If Ponder hasn't created its tables yet, swallow the relation-not-found error
 *  so the API can serve empty results during cold start. */
async function safe<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "42P01") return null;
    throw err;
  }
}

// --- row mappers ---------------------------------------------------------

type DbToken = typeof tokens.$inferSelect;
type DbTokenMetadata = typeof tokenMetadata.$inferSelect;
type DbTrade = typeof trades.$inferSelect;
type DbCandle = typeof candles.$inferSelect;
type DbGraduation = typeof graduations.$inferSelect;

function mapToken(r: DbToken): TokenRow {
  return {
    address: r.address as string,
    creator: r.creator as string,
    name: r.name,
    symbol: r.symbol,
    metadataUri: r.metadataUri,
    totalSupply: bi(r.totalSupply),
    maxSupplyForSale: bi(r.maxSupplyForSale),
    lpSupply: bi(r.lpSupply),
    fundingGoal: bi(r.fundingGoal),
    virtualEthReserve: bi(r.virtualEthReserve),
    virtualTokenReserve: bi(r.virtualTokenReserve),
    tradeFeeBps: num(r.tradeFeeBps),
    creatorFeeShareBps: num(r.creatorFeeShareBps),
    graduationFeeBps: num(r.graduationFeeBps),
    realEthRaised: bi(r.realEthRaised),
    tokensSold: bi(r.tokensSold),
    currentPriceX18: bi(r.currentPriceX18),
    marketCap: bi(r.marketCap),
    graduated: Boolean(r.graduated),
    pair: (r.pair as string | null) ?? null,
    tradeCount: num(r.tradeCount),
    volumeNative: bi(r.volumeNative),
    lastTradeAt: biNull(r.lastTradeAt),
    createdAtBlock: bi(r.createdAtBlock),
    createdAtTx: r.createdAtTx as string,
    createdAt: bi(r.createdAt),
  };
}

function mapMetadata(r: DbTokenMetadata | null): MetadataRow | null {
  if (!r) return null;
  return {
    status: r.status as MetadataRow["status"],
    description: r.description ?? null,
    imageUrl: r.imageUrl ?? null,
    bannerUrl: r.bannerUrl ?? null,
    website: r.website ?? null,
    twitter: r.twitter ?? null,
    telegram: r.telegram ?? null,
    discord: r.discord ?? null,
    tags: (r.tags as string[] | null) ?? null,
  };
}

function mapTrade(r: DbTrade): TradeRow {
  return {
    id: r.id,
    token: r.token as string,
    trader: r.trader as string,
    isBuy: Boolean(r.isBuy),
    ethAmount: bi(r.ethAmount),
    tokenAmount: bi(r.tokenAmount),
    feeAmount: bi(r.feeAmount),
    source: (r.source as "curve" | "dex" | null) ?? "curve",
    priceX18: bi(r.priceX18),
    realEthRaised: bi(r.realEthRaised),
    tokensSold: bi(r.tokensSold),
    blockNumber: bi(r.blockNumber),
    logIndex: num(r.logIndex),
    txHash: r.txHash as string,
    timestamp: bi(r.timestamp),
  };
}

function mapCandle(r: DbCandle): CandleRow {
  return {
    bucketStart: bi(r.bucketStart),
    open: bi(r.open),
    high: bi(r.high),
    low: bi(r.low),
    close: bi(r.close),
    volume: bi(r.volume),
    trades: num(r.trades),
  };
}

// --- public API ----------------------------------------------------------

export type TokenSort = "newest" | "oldest" | "marketCap" | "volume24h" | "lastTrade" | "graduating";
export type TokenStatus = "all" | "bonding" | "graduated";

export async function listTokens(opts: {
  search?: string;
  tag?: string;
  status?: TokenStatus;
  sort?: TokenSort;
  page: number;
  limit: number;
}): Promise<{ items: { token: TokenRow; metadata: MetadataRow | null; volume24h: bigint }[]; total: number }> {
  const cutoff = BigInt(Math.floor(Date.now() / 1000) - DAY);
  const status = opts.status ?? "all";
  const sortKey = opts.sort ?? "newest";
  const offset = (opts.page - 1) * opts.limit;

  const filters = [];
  if (opts.search && opts.search.trim()) {
    const q = `%${opts.search.trim().toLowerCase()}%`;
    filters.push(sql`(lower(${tokens.name}) like ${q} or lower(${tokens.symbol}) like ${q} or lower(${tokens.address}) like ${q})`);
  }
  if (opts.tag && opts.tag.trim()) {
    filters.push(sql`${tokenMetadata.tags} ? ${opts.tag.trim()}`);
  }
  if (status === "bonding") filters.push(eq(tokens.graduated, false));
  if (status === "graduated") filters.push(eq(tokens.graduated, true));
  const where = filters.length > 0 ? and(...filters) : undefined;

  const volume24h = sql<string>`coalesce((
    select sum(${trades.ethAmount}) from ${trades}
    where ${trades.token} = ${tokens.address} and ${trades.timestamp} >= ${cutoff}
  ), 0)`.as("v24");

  const orderBy = (() => {
    switch (sortKey) {
      case "oldest": return asc(tokens.createdAt);
      case "marketCap": return desc(tokens.marketCap);
      case "volume24h": return sql`v24 desc nulls last`;
      case "lastTrade": return sql`${tokens.lastTradeAt} desc nulls last`;
      case "graduating": return sql`(case when ${tokens.graduated} then -1 else (${tokens.realEthRaised}::numeric / nullif(${tokens.fundingGoal}, 0)) end) desc nulls last`;
      case "newest":
      default: return desc(tokens.createdAt);
    }
  })();

  const dataQuery = db
    .select({ token: tokens, metadata: tokenMetadata, volume24h })
    .from(tokens)
    .leftJoin(tokenMetadata, eq(tokenMetadata.token, tokens.address))
    .where(where)
    .orderBy(orderBy)
    .limit(opts.limit)
    .offset(offset);

  const countQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(tokens)
    .leftJoin(tokenMetadata, eq(tokenMetadata.token, tokens.address))
    .where(where);

  const [dataRows, countRows] = await Promise.all([safe(dataQuery), safe(countQuery)]);
  if (!dataRows) return { items: [], total: 0 };

  return {
    items: dataRows.map((r) => ({
      token: mapToken(r.token),
      metadata: mapMetadata(r.metadata),
      volume24h: bi(r.volume24h),
    })),
    total: num(countRows?.[0]?.count),
  };
}

export async function getToken(
  address: string,
): Promise<{ token: TokenRow; metadata: MetadataRow | null } | null> {
  const rows = await safe(
    db
      .select({ token: tokens, metadata: tokenMetadata })
      .from(tokens)
      .leftJoin(tokenMetadata, eq(tokenMetadata.token, tokens.address))
      .where(eq(tokens.address, address.toLowerCase() as `0x${string}`))
      .limit(1),
  );
  if (!rows || rows.length === 0) return null;
  return { token: mapToken(rows[0]!.token), metadata: mapMetadata(rows[0]!.metadata) };
}

export async function getTokenStats(token: TokenRow): Promise<TokenStats> {
  const cutoff = BigInt(Math.floor(Date.now() / 1000) - DAY);
  const pairLower = (token.pair ?? "0x0000000000000000000000000000000000000000").toLowerCase();

  const rows = await safe(
    db.execute(sql`
      select
        coalesce((select sum(${trades.ethAmount}) from ${trades}
                  where ${trades.token} = ${token.address} and ${trades.timestamp} >= ${cutoff}), 0) as v24,
        coalesce((select sum(${trades.ethAmount}) from ${trades}
                  where ${trades.token} = ${token.address}), 0) as vtotal,
        (select ${trades.priceX18} from ${trades}
          where ${trades.token} = ${token.address} and ${trades.timestamp} < ${cutoff}
          order by ${trades.timestamp} desc limit 1) as price_24h_ago,
        (select count(*)::int from ${holders}
          where ${holders.token} = ${token.address} and ${holders.balance} > 0
            and lower(${holders.address}) not in (${LAUNCHPAD}, ${pairLower}, ${DEAD})) as holder_count
    `),
  );
  const r = rows?.[0] as { v24?: unknown; vtotal?: unknown; price_24h_ago?: unknown; holder_count?: unknown } | undefined;

  const v24 = bi(r?.v24);
  const vTotal = bi(r?.vtotal);
  const holderCount = num(r?.holder_count);
  let priceChange24hBps = 0;
  const prev = biNull(r?.price_24h_ago);
  if (prev && prev > 0n) {
    priceChange24hBps = Number(((token.currentPriceX18 - prev) * 10_000n) / prev);
  }
  return { volume24h: v24, volumeTotal: vTotal, priceChange24hBps, holderCount };
}

/** 24h price change in bps for many tokens (one round-trip). */
export async function batchPriceChange24hBps(tokenRows: TokenRow[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (tokenRows.length === 0) return out;

  const cutoff = BigInt(Math.floor(Date.now() / 1000) - DAY);
  const addrs = tokenRows.map((t) => t.address.toLowerCase() as `0x${string}`);

  const rows = await safe(
    db.execute(sql`
      select
        ${tokens.address} as address,
        (select ${trades.priceX18} from ${trades}
          where ${trades.token} = ${tokens.address} and ${trades.timestamp} < ${cutoff}
          order by ${trades.timestamp} desc limit 1) as price_24h_ago
      from ${tokens}
      where ${inArray(tokens.address, addrs)}
    `),
  );

  for (const t of tokenRows) {
    const key = t.address.toLowerCase();
    const row = (rows as { address?: string; price_24h_ago?: unknown }[] | null)?.find(
      (r) => String(r.address).toLowerCase() === key,
    );
    let priceChange24hBps = 0;
    const prev = biNull(row?.price_24h_ago);
    if (prev && prev > 0n) {
      priceChange24hBps = Number(((t.currentPriceX18 - prev) * 10_000n) / prev);
    }
    out.set(key, priceChange24hBps);
  }
  return out;
}

export type TrendingTokenRow = {
  token: TokenRow;
  metadata: MetadataRow | null;
  volume24h: bigint;
  priceChange24hBps: number;
};

/** Homepage carousel: bonding tokens ranked by 24h volume with price-change badges. */
export async function listTrendingTokens(limit: number): Promise<TrendingTokenRow[]> {
  const { items } = await listTokens({
    status: "bonding",
    sort: "volume24h",
    page: 1,
    limit,
  });
  const priceMap = await batchPriceChange24hBps(items.map((i) => i.token));
  return items.map((it) => ({
    token: it.token,
    metadata: it.metadata,
    volume24h: it.volume24h,
    priceChange24hBps: priceMap.get(it.token.address.toLowerCase()) ?? 0,
  }));
}

export async function listTrades(
  token: string,
  page: number,
  limit: number,
): Promise<{ items: TradeRow[]; total: number }> {
  const offset = (page - 1) * limit;
  const tokenLower = token.toLowerCase() as `0x${string}`;
  const [dataRows, countRows] = await Promise.all([
    safe(
      db
        .select()
        .from(trades)
        .where(eq(trades.token, tokenLower))
        .orderBy(desc(trades.blockNumber), desc(trades.logIndex))
        .limit(limit)
        .offset(offset),
    ),
    safe(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(trades)
        .where(eq(trades.token, tokenLower)),
    ),
  ]);
  return { items: (dataRows ?? []).map(mapTrade), total: num(countRows?.[0]?.count) };
}

export async function listRecentTrades(limit: number): Promise<TradeRow[]> {
  const rows = await safe(
    db.select().from(trades).orderBy(desc(trades.blockNumber), desc(trades.logIndex)).limit(limit),
  );
  return (rows ?? []).map(mapTrade);
}

export async function getCandles(opts: {
  token: string;
  interval: number;
  from?: number;
  to?: number;
  limit: number;
}): Promise<CandleRow[]> {
  const filters = [
    eq(candles.token, opts.token.toLowerCase() as `0x${string}`),
    eq(candles.interval, opts.interval),
  ];
  if (opts.from != null) filters.push(gte(candles.bucketStart, BigInt(opts.from)));
  if (opts.to != null) filters.push(lte(candles.bucketStart, BigInt(opts.to)));

  const rows = await safe(
    db
      .select()
      .from(candles)
      .where(and(...filters))
      .orderBy(asc(candles.bucketStart))
      .limit(opts.limit),
  );
  return (rows ?? []).map(mapCandle);
}

export async function topHolders(
  token: string,
  pair: string | null,
  limit: number,
): Promise<{ address: string; balance: bigint }[]> {
  const exclude = [token.toLowerCase(), LAUNCHPAD, DEAD];
  if (pair) exclude.push(pair.toLowerCase());

  const rows = await safe(
    db
      .select({ address: holders.address, balance: holders.balance })
      .from(holders)
      .where(
        and(
          eq(holders.token, token.toLowerCase() as `0x${string}`),
          gt(holders.balance, 0n),
          sql`lower(${holders.address}) not in ${sql.raw(`(${exclude.map((e) => `'${e}'`).join(", ")})`)}`,
        ),
      )
      .orderBy(desc(holders.balance))
      .limit(limit),
  );
  return (rows ?? []).map((r) => ({ address: r.address as string, balance: bi(r.balance) }));
}

export async function getAccount(address: string): Promise<{
  created: { token: TokenRow; metadata: MetadataRow | null }[];
  holdings: { token: string; balance: bigint }[];
  recentTrades: TradeRow[];
}> {
  const a = address.toLowerCase() as `0x${string}`;
  const [createdRows, holdingRows, tradeRows] = await Promise.all([
    safe(
      db
        .select({ token: tokens, metadata: tokenMetadata })
        .from(tokens)
        .leftJoin(tokenMetadata, eq(tokenMetadata.token, tokens.address))
        .where(sql`lower(${tokens.creator}) = ${a}`)
        .orderBy(desc(tokens.createdAt)),
    ),
    safe(
      db
        .select({ token: holders.token, balance: holders.balance })
        .from(holders)
        .where(and(sql`lower(${holders.address}) = ${a}`, gt(holders.balance, 0n)))
        .orderBy(desc(holders.balance))
        .limit(200),
    ),
    safe(
      db
        .select()
        .from(trades)
        .where(sql`lower(${trades.trader}) = ${a}`)
        .orderBy(desc(trades.blockNumber), desc(trades.logIndex))
        .limit(50),
    ),
  ]);
  return {
    created: (createdRows ?? []).map((r) => ({ token: mapToken(r.token), metadata: mapMetadata(r.metadata) })),
    holdings: (holdingRows ?? []).map((r) => ({ token: r.token as string, balance: bi(r.balance) })),
    recentTrades: (tradeRows ?? []).map(mapTrade),
  };
}

export async function search(
  q: string,
  limit: number,
): Promise<{ token: TokenRow; metadata: MetadataRow | null }[]> {
  const like = `%${q.trim().toLowerCase()}%`;
  const addrLower = q.trim().toLowerCase();
  const rows = await safe(
    db
      .select({ token: tokens, metadata: tokenMetadata })
      .from(tokens)
      .leftJoin(tokenMetadata, eq(tokenMetadata.token, tokens.address))
      .where(
        sql`(lower(${tokens.name}) like ${like} or lower(${tokens.symbol}) like ${like} or lower(${tokens.address}) = ${addrLower})`,
      )
      .orderBy(desc(tokens.marketCap))
      .limit(limit),
  );
  return (rows ?? []).map((r) => ({ token: mapToken(r.token), metadata: mapMetadata(r.metadata) }));
}

// --- metadata resolver ---------------------------------------------------

// Grace window (seconds) a claimed row is hidden from other claimers while a
// resolve is in flight. resolveOne() always overwrites `nextAttemptAt` on both
// its success and failure paths, so this is purely a claim marker — if the
// process crashes mid-resolve the row simply becomes claimable again once the
// window elapses, with no orphaned state to clean up.
//
// Must comfortably exceed fetchTokenMetadata()'s worst case: it tries each
// configured IPFS gateway in sequence, up to FETCH_TIMEOUT_MS each, so total
// worst-case time scales with config.IPFS_GATEWAYS.length. This derives from
// both rather than hardcoding a number, so the race this constant exists to
// close doesn't silently reopen if someone adds gateways later. The +15s is
// slack for everything around the fetch loop itself (DB round-trips, JSON
// parsing, Zod validation, event-loop scheduling) — not just the network
// calls the formula accounts for directly.
const IPFS_WORST_CASE_SEC = Math.ceil((config.IPFS_GATEWAYS.length * FETCH_TIMEOUT_MS) / 1000);
const CLAIM_GRACE_SEC = IPFS_WORST_CASE_SEC + 15;

/**
 * Claim pending metadata rows for the resolver. Uses FOR UPDATE SKIP LOCKED
 * *inside a transaction that also marks the claimed rows*, so concurrent
 * resolvers (e.g. if you ever run two API replicas, or the NOTIFY-driven
 * `resolveNow` firing while the sweep timer's claim is still in flight) won't
 * double-process the same token.
 *
 * Without the marker UPDATE in the same transaction, `FOR UPDATE SKIP LOCKED`
 * only protects against two callers selecting at the *exact same instant* —
 * as a bare statement it auto-commits (and releases its row lock) the moment
 * the SELECT returns, so a claim moments later (e.g. while the first claim's
 * IPFS fetch is still running) would re-select the same still-"pending" row.
 */
export async function claimPendingMetadata(
  limit: number,
): Promise<{ token: string; metadataUri: string; attempts: number }[]> {
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const claimedUntil = nowSec + BigInt(CLAIM_GRACE_SEC);

  const rows = await safe(
    db.transaction(async (tx) => {
      const claimable = await tx.execute(sql`
        select ${tokenMetadata.token} as token,
               ${tokenMetadata.metadataUri} as metadata_uri,
               ${tokenMetadata.attempts} as attempts
        from ${tokenMetadata}
        where (
          ${tokenMetadata.status} = 'pending'
          or (${tokenMetadata.status} = 'failed' and ${tokenMetadata.attempts} < 8)
        )
        and (
          ${tokenMetadata.nextAttemptAt} is null
          or ${tokenMetadata.nextAttemptAt} <= ${nowSec}
        )
        order by ${tokenMetadata.updatedAt} asc
        limit ${limit}
        for update skip locked
      `);
      const claimedRows = claimable as unknown as { token: string; metadata_uri: string; attempts: number }[];
      if (claimedRows.length === 0) return claimedRows;

      const tokens = claimedRows.map((r) => r.token);
      await tx.execute(sql`
        update ${tokenMetadata}
        set next_attempt_at = ${claimedUntil}
        where ${tokenMetadata.token} in ${tokens}
      `);
      return claimedRows;
    }),
  );

  return ((rows ?? []) as unknown as { token: string; metadata_uri: string; attempts: number }[]).map((r) => ({
    token: r.token,
    metadataUri: r.metadata_uri,
    attempts: num(r.attempts),
  }));
}

/**
 * Claim a single pending row by token address (NOTIFY-driven path). Returns
 * null if the row isn't pending / not due yet / already claimed by another
 * worker — every caller must treat null as "nothing to do". See
 * `claimPendingMetadata` above for why the claim + marker UPDATE must share
 * one transaction.
 */
export async function claimPendingMetadataByToken(
  token: string,
): Promise<{ token: string; metadataUri: string; attempts: number } | null> {
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const claimedUntil = nowSec + BigInt(CLAIM_GRACE_SEC);
  const addr = token.toLowerCase() as `0x${string}`;

  const row = await safe(
    db.transaction(async (tx) => {
      const claimable = await tx.execute(sql`
        select ${tokenMetadata.token} as token,
               ${tokenMetadata.metadataUri} as metadata_uri,
               ${tokenMetadata.attempts} as attempts
        from ${tokenMetadata}
        where ${tokenMetadata.token} = ${addr}
          and (
            ${tokenMetadata.status} = 'pending'
            or (${tokenMetadata.status} = 'failed' and ${tokenMetadata.attempts} < 8)
          )
          and (
            ${tokenMetadata.nextAttemptAt} is null
            or ${tokenMetadata.nextAttemptAt} <= ${nowSec}
          )
        limit 1
        for update skip locked
      `);
      const r = (claimable as unknown as { token: string; metadata_uri: string; attempts: number }[])[0];
      if (!r) return null;

      await tx.execute(sql`
        update ${tokenMetadata}
        set next_attempt_at = ${claimedUntil}
        where ${tokenMetadata.token} = ${addr}
      `);
      return r;
    }),
  );

  const r = row as { token: string; metadata_uri: string; attempts: number } | null | undefined;
  if (!r) return null;
  return { token: r.token, metadataUri: r.metadata_uri, attempts: num(r.attempts) };
}

// --- /v1/status ---------------------------------------------------------

export async function indexedBlock(): Promise<bigint> {
  const rows = await safe(
    db.execute(sql`
      select greatest(
        coalesce((select max(${tokens.createdAtBlock}) from ${tokens}), 0),
        coalesce((select max(${trades.blockNumber}) from ${trades}), 0),
        coalesce((select max(${graduations.blockNumber}) from ${graduations}), 0)
      ) as b
    `),
  );
  return bi((rows?.[0] as { b?: unknown } | undefined)?.b);
}

export async function getGraduation(
  token: string,
): Promise<DbGraduation | null> {
  const addr = token.toLowerCase() as `0x${string}`;
  const rows = await safe(
    db.select().from(graduations).where(eq(graduations.token, addr)).limit(1),
  );
  return rows?.[0] ?? null;
}

// Silence unused-import lints — reserved for future queries.
void inArray;
void lt;
export type { DbGraduation };
