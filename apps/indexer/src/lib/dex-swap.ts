import { eq } from "ponder";
import { graduation as graduations, token as tokens } from "ponder:schema";
import { launchpadAbi, uniswapV2PairAbi, uniswapV2Router02Abi } from "@lcai/abis";
import { getAddress } from "viem";
import type { Context } from "ponder:registry";

// The pure decoding lives in a sibling with no `ponder:*` imports so it can be
// unit-tested; re-exported here so existing import sites are unchanged.
export {
  parseDexSwapAmounts,
  type DexSwapAmounts,
  type PairMeta,
} from "./dex-swap-math.js";
import type { PairMeta } from "./dex-swap-math.js";

const launchpadAddress = (process.env.LAUNCHPAD_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

/** One-time on-chain reads at graduation; persisted to `graduations` table. */
export async function resolveGraduationPairMeta(
  context: Context,
  token: `0x${string}`,
  pair: `0x${string}`,
): Promise<{ weth: `0x${string}`; sourceIsToken0: boolean } | null> {
  const [token0, token1, router] = await Promise.all([
    context.client.readContract({
      abi: uniswapV2PairAbi,
      address: pair,
      functionName: "token0",
    }),
    context.client.readContract({
      abi: uniswapV2PairAbi,
      address: pair,
      functionName: "token1",
    }),
    context.client.readContract({
      abi: launchpadAbi,
      address: launchpadAddress,
      functionName: "dexRouter",
    }),
  ]);

  const weth = await context.client.readContract({
    abi: uniswapV2Router02Abi,
    address: router,
    functionName: "WETH",
  });

  const sourceIsToken0 = token0.toLowerCase() === token.toLowerCase();
  const sourceToken = sourceIsToken0 ? token0 : token1;
  if (sourceToken.toLowerCase() !== token.toLowerCase()) return null;

  return { weth, sourceIsToken0 };
}

/** Load pair layout from DB — no RPC on the swap hot path. */
export async function getPairMeta(
  context: Context,
  pair: `0x${string}`,
): Promise<PairMeta | null> {
  const normalizedPair = getAddress(pair);

  const rows = await context.db.sql
    .select({
      token: graduations.token,
      weth: graduations.weth,
      sourceIsToken0: graduations.sourceIsToken0,
    })
    .from(graduations)
    .where(eq(graduations.pair, normalizedPair))
    .limit(1);

  const row = rows[0];
  if (row?.token && row.weth) {
    return {
      token: row.token,
      weth: row.weth,
      sourceIsToken0: row.sourceIsToken0,
    };
  }

  // Swap may arrive in the same block as Graduated before the row is written.
  const tokenRows = await context.db.sql
    .select({ address: tokens.address })
    .from(tokens)
    .where(eq(tokens.pair, normalizedPair))
    .limit(1);

  const token = tokenRows[0]?.address;
  if (!token) return null;

  const resolved = await resolveGraduationPairMeta(context, token, normalizedPair);
  if (!resolved) return null;

  return {
    token,
    weth: resolved.weth,
    sourceIsToken0: resolved.sourceIsToken0,
  };
}

