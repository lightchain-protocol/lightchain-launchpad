import "./lib/json.js"; // BigInt#toJSON patch — must run before any JSON.stringify(payload)

import { ponder } from "ponder:registry";
import {
  token as tokens,
  trade as trades,
  graduation as graduations,
  holder as holders,
  candle as candles,
  tokenMetadata as tokenMetadata,
} from "ponder:schema";

import { launchpadAbi } from "@lcai/abis";

import { notify } from "./notify.js";
import { upsertCandles } from "./lib/candles.js";
import {
  getPairMeta,
  parseDexSwapAmounts,
  resolveGraduationPairMeta,
} from "./lib/dex-swap.js";
import { startStatusBroadcaster } from "./status-broadcaster.js";
import {
  isRealtimeEvent,
  toTokenDTO,
  toTradeDTO,
  tokenUpdateFromDTO,
  type TokenRow,
  type GraduationDTO,
} from "./dto.js";

// Periodic NOTIFY of indexer-vs-RPC head so the API can fan a status SSE event
// to subscribers showing a "syncing…" indicator. Module-scoped so it only ever
// starts once even if Ponder hot-reloads this file in dev.
startStatusBroadcaster();

const WAD = 10n ** 18n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

function priceFromReserves(
  virtualEthReserve: bigint,
  realEthRaised: bigint,
  virtualTokenReserve: bigint,
  tokensSold: bigint,
): bigint {
  const tokenReserve = virtualTokenReserve - tokensSold;
  if (tokenReserve <= 0n) return 0n;
  return ((virtualEthReserve + realEthRaised) * WAD) / tokenReserve;
}

// ---------------------------------------------------------------------------
// Token launch: create the token row purely from on-chain data + insert a
// `pending` token_metadata row for the API-side resolver to pick up. A dev-buy
// Trade and a same-tx Graduated (if any) arrive as later events in the same tx
// and bring the live state up to date via the handlers below.
// ---------------------------------------------------------------------------
ponder.on("Launchpad:TokenLaunched", async ({ event, context }) => {
  const { token, creator, name, symbol, metadataURI } = event.args;

  const curve = await context.client.readContract({
    abi: launchpadAbi,
    address: event.log.address,
    functionName: "curves",
    args: [token],
  });

  const maxSupplyForSale = BigInt(curve.maxSupplyForSale);
  const lpSupply = BigInt(curve.lpSupply);
  const fundingGoal = BigInt(curve.fundingGoal);
  const virtualEthReserve = BigInt(curve.virtualEthReserve);
  const virtualTokenReserve = BigInt(curve.virtualTokenReserve);

  const totalSupply = maxSupplyForSale + lpSupply;
  const currentPriceX18 = priceFromReserves(
    virtualEthReserve,
    0n,
    virtualTokenReserve,
    0n,
  );
  const marketCap = (currentPriceX18 * totalSupply) / WAD;

  const row = {
    address: token,
    creator,
    name,
    symbol,
    metadataUri: metadataURI,
    totalSupply,
    maxSupplyForSale,
    lpSupply,
    fundingGoal,
    virtualEthReserve,
    virtualTokenReserve,
    tradeFeeBps: Number(curve.tradeFeeBps),
    creatorFeeShareBps: Number(curve.creatorFeeShareBps),
    graduationFeeBps: Number(curve.graduationFeeBps),
    realEthRaised: 0n,
    tokensSold: 0n,
    currentPriceX18,
    marketCap,
    graduated: false,
    pair: null,
    tradeCount: 0,
    volumeNative: 0n,
    lastTradeAt: null,
    createdAtBlock: event.block.number,
    createdAtTx: event.transaction.hash,
    createdAt: event.block.timestamp,
  };

  await context.db.insert(tokens).values(row);

  // Enqueue metadata resolution. The API-side resolver claims pending rows via
  // SELECT … FOR UPDATE SKIP LOCKED and writes the resolved fields here.
  await context.db
    .insert(tokenMetadata)
    .values({
      token,
      metadataUri: metadataURI,
      status: "pending",
      attempts: 0,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoNothing();

  if (isRealtimeEvent(event.block.timestamp)) {
    await notify(context.db, "token:new", {
      token: toTokenDTO(row as TokenRow),
    });
    // Wake the resolver immediately — no polling-loop latency for fresh launches.
    await notify(context.db, "metadata:pending", { token });
  }
});

// ---------------------------------------------------------------------------
// Trade: record it, update the token's live state + rolling aggregates, upsert
// the OHLCV bucket for every interval, and fan out realtime notifications.
// ---------------------------------------------------------------------------
ponder.on("Launchpad:Trade", async ({ event, context }) => {
  const {
    token,
    user,
    isBuy,
    ethAmount,
    tokenAmount,
    feeAmount,
    priceX18,
    realEthRaised,
    tokensSold,
  } = event.args;
  const ts = event.block.timestamp;

  const tradeRow = {
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    token,
    trader: user,
    isBuy,
    ethAmount,
    tokenAmount,
    feeAmount,
    source: "curve" as const,
    priceX18,
    realEthRaised,
    tokensSold,
    blockNumber: event.block.number,
    logIndex: event.log.logIndex,
    txHash: event.transaction.hash,
    timestamp: ts,
  };

  await context.db.insert(trades).values(tradeRow);

  const updatedToken = await context.db
    .update(tokens, { address: token })
    .set((r) => ({
      realEthRaised,
      tokensSold,
      currentPriceX18: priceX18,
      marketCap: (priceX18 * r.totalSupply) / WAD,
      tradeCount: r.tradeCount + 1,
      volumeNative: r.volumeNative + ethAmount,
      lastTradeAt: ts,
    }));

  await upsertCandles(context.db, token, priceX18, ethAmount, ts);

  if (isRealtimeEvent(ts) && updatedToken) {
    const tokenDTO = toTokenDTO(updatedToken as TokenRow);
    const tradeDTO = toTradeDTO(tradeRow);
    await notify(context.db, "trade", { token, trade: tradeDTO, tokenDTO });
    await notify(context.db, "token:update", tokenUpdateFromDTO(tokenDTO));
  }
});

// ---------------------------------------------------------------------------
// Graduation: record it, flip the token to graduated, and notify subscribers.
// ---------------------------------------------------------------------------
ponder.on("Launchpad:Graduated", async ({ event, context }) => {
  const { token, pair, ethToLp, tokensToLp, tokensBurned, degradedPath } =
    event.args;

  const pairMeta = await resolveGraduationPairMeta(context, token, pair);
  if (!pairMeta) return;

  await context.db.insert(graduations).values({
    token,
    pair,
    weth: pairMeta.weth,
    sourceIsToken0: pairMeta.sourceIsToken0,
    ethToLp,
    tokensToLp,
    tokensBurned,
    degradedPath,
    blockNumber: event.block.number,
    txHash: event.transaction.hash,
    timestamp: event.block.timestamp,
  });

  const gradPriceX18 = tokensToLp > 0n ? (ethToLp * WAD) / tokensToLp : null;

  await context.db
    .update(tokens, { address: token })
    .set((r) => ({
      graduated: true,
      pair,
      ...(gradPriceX18 != null
        ? {
          currentPriceX18: gradPriceX18,
          marketCap: (gradPriceX18 * r.totalSupply) / WAD,
        }
        : {}),
    }));

  if (gradPriceX18 != null) {
    await upsertCandles(context.db, token, gradPriceX18, ethToLp, event.block.timestamp);
  }

  if (isRealtimeEvent(event.block.timestamp)) {
    const dto: GraduationDTO = {
      token,
      pair,
      ethToLp: ethToLp.toString(),
      tokensToLp: tokensToLp.toString(),
      tokensBurned: tokensBurned.toString(),
      degradedPath,
      txHash: event.transaction.hash,
      blockNumber: event.block.number.toString(),
      timestamp: new Date(Number(event.block.timestamp) * 1000).toISOString(),
    };
    await notify(context.db, "token:graduated", dto);
  }
});

// ---------------------------------------------------------------------------
// Uniswap V2 Swap: record DEX trades for graduated tokens, update candles and
// live price, and fan out the same realtime trade/update notifications.
// ---------------------------------------------------------------------------
ponder.on("UniswapV2Pair:Swap", async ({ event, context }) => {
  const pair = event.log.address;
  const { sender, to, amount0In, amount1In, amount0Out, amount1Out } = event.args;
  const ts = event.block.timestamp;

  const meta = await getPairMeta(context, pair);
  if (!meta) return;

  const amounts = parseDexSwapAmounts(meta, amount0In, amount1In, amount0Out, amount1Out);
  if (!amounts) return;

  const { isBuy, ethAmount, tokenAmount, priceX18 } = amounts;
  const token = meta.token;

  const tokenRow = await context.db.find(tokens, { address: token });
  if (!tokenRow) return;

  // `transaction.from` is not always populated by the indexer; fall back to the
  // swap recipient (`to`) which is the EOA when routing through the DEX router.
  const trader = event.transaction.from ?? to ?? sender;
  if (!trader) return;

  const tradeRow = {
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    token,
    trader,
    isBuy,
    ethAmount,
    tokenAmount,
    feeAmount: 0n,
    source: "dex" as const,
    priceX18,
    realEthRaised: tokenRow.realEthRaised,
    tokensSold: tokenRow.tokensSold,
    blockNumber: event.block.number,
    logIndex: event.log.logIndex,
    txHash: event.transaction.hash,
    timestamp: ts,
  };

  await context.db.insert(trades).values(tradeRow);

  const updatedToken = await context.db
    .update(tokens, { address: token })
    .set((r) => ({
      currentPriceX18: priceX18,
      marketCap: (priceX18 * r.totalSupply) / WAD,
      tradeCount: r.tradeCount + 1,
      volumeNative: r.volumeNative + ethAmount,
      lastTradeAt: ts,
    }));
  await upsertCandles(context.db, token, priceX18, ethAmount, ts);

  if (isRealtimeEvent(ts) && updatedToken) {
    const tokenDTO = toTokenDTO(updatedToken as TokenRow);
    const tradeDTO = toTradeDTO(tradeRow);
    await notify(context.db, "trade", { token, trade: tradeDTO, tokenDTO });
    await notify(context.db, "token:update", tokenUpdateFromDTO(tokenDTO));
  }
});

// ---------------------------------------------------------------------------
// ERC20 Transfer on every launched Token → maintain holder balances.
// (Mints come from / burns go to the zero address; we don't track it.)
// ---------------------------------------------------------------------------
ponder.on("Token:Transfer", async ({ event, context }) => {
  const tokenAddress = event.log.address;
  const { from, to, value } = event.args;
  if (value === 0n) return;

  if (from !== ZERO_ADDRESS) {
    await context.db
      .update(holders, { token: tokenAddress, address: from })
      .set((row) => ({ balance: row.balance - value }));
  }
  if (to !== ZERO_ADDRESS) {
    await context.db
      .insert(holders)
      .values({ token: tokenAddress, address: to, balance: value })
      .onConflictDoUpdate((row) => ({ balance: row.balance + value }));
  }
});
