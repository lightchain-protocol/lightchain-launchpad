import { ParsedUrlQuery, stringify as stringifyQueryString } from "querystring";
import { clsx } from "clsx";
import { formatEther, formatUnits } from "viem";

export const MAX_UINT256 = 2n ** 256n - 1n;

/** Canonical form for token addresses in React Query keys and socket.io rooms. */
export const normalizeTokenAddress = (address: string): `0x${string}` =>
  address.toLowerCase() as `0x${string}`;

export const cn = clsx;

export const formatNumber = (
  num: number | string | undefined,
  options?: Intl.NumberFormatOptions
) => {
  if (!num) return "0";
  return Number(num).toLocaleString(undefined, {
    maximumFractionDigits: 4,
    ...options,
  });
};

export const formatBigNumber = (num: bigint | string | null | undefined, options?: Intl.NumberFormatOptions, decimals = 18) => {
  if (!num) return "0";
  return formatNumber(formatUnits(BigInt(num), decimals), options);
};

/** Format wei amounts for trade/holder tables (full notation, not compact). */
export const formatTradeAmount = (wei: string, maxFractionDigits = 8): string => {
  try {
    return Number(formatEther(BigInt(wei))).toLocaleString(undefined, {
      maximumFractionDigits: maxFractionDigits,
      notation: "standard",
    });
  } catch {
    return "0";
  }
};

export const getRouteAsPath = (
  pathname: string,
  query: NodeJS.Dict<string | (string | undefined)[]>,
  hash?: string | null
) => {
  const remainingQuery = { ...query };

  // Replace slugs, and remove them from the `query` and filter undefined values
  let asPath = pathname.replace(/\[{1,2}(.+?)]{1,2}/g, ($0, slug: string) => {
    if (slug.startsWith("...")) slug = slug.replace("...", "");

    const value = remainingQuery[slug]!;
    delete remainingQuery[slug];
    if (Array.isArray(value)) {
      return value
        .filter(Boolean)
        .map((v) => encodeURIComponent(v as string))
        .join("/");
    }
    return value !== undefined ? encodeURIComponent(String(value)) : "";
  });

  // Remove any trailing slashes; this can occur if there is no match for a catch-all slug ([[...slug]])
  asPath = removeTrailingSlash(asPath);

  // Append remaining query as a querystring, if needed:
  const qs = stringifyQueryString(remainingQuery as ParsedUrlQuery);

  if (qs) asPath += `?${qs}`;
  if (hash) asPath += hash;

  return asPath;
};

export const removeTrailingSlash = (path: string) => {
  return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
};

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// --- trade settings ------------------------------------------------------
// Slippage and deadline are user-editable and persisted to localStorage, so
// they can arrive as anything — out of range, NaN, or a hand-edited string.
// They feed straight into BigInt math that builds minTokensOut / minEthOut /
// deadline, where a bad value throws before the wallet opens or produces a
// transaction that always reverts. Clamp at every boundary.

export const SLIPPAGE_DEFAULT = 0.5;
export const SLIPPAGE_MIN = 0.1;
/** Keeps `bps` <= 5_000 so `10_000n - bps` in applySlippage can never go negative. */
export const SLIPPAGE_MAX = 50;

export const DEADLINE_DEFAULT = 20;
export const DEADLINE_MIN = 2;
export const DEADLINE_MAX = 4320; // 3 days, in minutes

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  // Absent means "use the default"; Number(null) and Number("") are both 0,
  // which would otherwise clamp to `min` and look like a deliberate choice.
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/** Slippage tolerance in percent, clamped to [SLIPPAGE_MIN, SLIPPAGE_MAX]. */
export function clampSlippage(value: unknown): number {
  return clampNumber(value, SLIPPAGE_MIN, SLIPPAGE_MAX, SLIPPAGE_DEFAULT);
}

/** Transaction deadline in whole minutes, clamped to [DEADLINE_MIN, DEADLINE_MAX]. */
export function clampDeadline(value: unknown): number {
  return Math.round(clampNumber(value, DEADLINE_MIN, DEADLINE_MAX, DEADLINE_DEFAULT));
}

/**
 * Apply the slippage tolerance to a quoted amount. `min` floors an output
 * (minTokensOut / minEthOut), `max` ceils an input (maxEthIn).
 * Clamps internally so a caller can never produce a negative bigint.
 */
export function applySlippage(
  amount: bigint,
  side: "min" | "max",
  slippageTolerance: number
): bigint {
  const bps = BigInt(Math.round(clampSlippage(slippageTolerance) * 100)); // % → bps
  return side === "min"
    ? (amount * (10_000n - bps)) / 10_000n
    : (amount * (10_000n + bps)) / 10_000n;
}

/** Unix-seconds deadline `txDeadlineMinutes` from now, for DEX router calls. */
export function deadlineFromNow(txDeadlineMinutes: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + clampDeadline(txDeadlineMinutes) * 60);
}
