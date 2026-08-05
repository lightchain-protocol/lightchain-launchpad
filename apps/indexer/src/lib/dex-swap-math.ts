/**
 * Pure DEX-swap decoding — no `ponder:*` virtual-module imports, so this is
 * directly unit-testable. `dex-swap.ts` re-exports everything here; import from
 * either.
 */

const WAD = 10n ** 18n;

export type PairMeta = {
  token: `0x${string}`;
  weth: `0x${string}`;
  sourceIsToken0: boolean;
};

export interface DexSwapAmounts {
  isBuy: boolean;
  ethAmount: bigint;
  tokenAmount: bigint;
  priceX18: bigint;
}

/**
 * Decode a UniswapV2 `Swap` event into a trade for the launched token.
 *
 * `sourceIsToken0` is resolved once at graduation and persisted on the
 * `graduations` row; it decides which side of the pair is the launched token.
 * Get it wrong and every DEX trade is recorded inverted, with `priceX18` as the
 * reciprocal of the true price — hence the tests.
 *
 * Returns null for `Swap` events that are not a token↔native trade.
 */
export function parseDexSwapAmounts(
  meta: PairMeta,
  amount0In: bigint,
  amount1In: bigint,
  amount0Out: bigint,
  amount1Out: bigint,
): DexSwapAmounts | null {
  const { sourceIsToken0 } = meta;

  const sourceIn = sourceIsToken0 ? amount0In : amount1In;
  const sourceOut = sourceIsToken0 ? amount0Out : amount1Out;
  const wethIn = sourceIsToken0 ? amount1In : amount0In;
  const wethOut = sourceIsToken0 ? amount1Out : amount0Out;

  const isBuy = sourceOut > 0n && wethIn > 0n;
  const isSell = sourceIn > 0n && wethOut > 0n;
  if (!isBuy && !isSell) return null;

  const ethAmount = isBuy ? wethIn : wethOut;
  const tokenAmount = isBuy ? sourceOut : sourceIn;
  if (tokenAmount === 0n) return null;

  const priceX18 = (ethAmount * WAD) / tokenAmount;
  return { isBuy, ethAmount, tokenAmount, priceX18 };
}
