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
  // Compact notation (e.g. "$12.3457K") inherits the general 4-digit default
  // otherwise, which reads as needlessly precise for a rounded magnitude --
  // 2 digits ("$12.35K") is the sensible default here. An explicit
  // maximumFractionDigits in `options` still wins, since it's spread last.
  const compactDefaults: Intl.NumberFormatOptions =
    options?.notation === "compact" ? { maximumFractionDigits: 2 } : {};
  return Number(num).toLocaleString(undefined, {
    maximumFractionDigits: 4,
    ...compactDefaults,
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

// --- quote freshness & price impact --------------------------------------
// The minimum a trade enforces on chain must be derived from the quote the user
// READ, not from a re-quote taken after they clicked — otherwise the tolerance
// only covers the milliseconds inside our own mutation, and the number on
// screen guarantees nothing. That anchoring is only safe while the displayed
// quote is fresh, so the forms refetch it every QUOTE_REFRESH_MS and refuse to
// sign one older than QUOTE_MAX_AGE_MS.

/** How often a displayed quote is refetched while its form is visible (ms). */
export const QUOTE_REFRESH_MS = 10_000;

/** Oldest displayed quote that may still be signed (ms). */
export const QUOTE_MAX_AGE_MS = 30_000;

/**
 * True when a quote fetched at `quotedAtMs` is too old to sign. TanStack
 * Query's `dataUpdatedAt` is `0` before the first successful fetch, which
 * counts as stale.
 */
export function isQuoteStale(
  quotedAtMs: number,
  nowMs: number = Date.now(),
  maxAgeMs: number = QUOTE_MAX_AGE_MS
): boolean {
  if (!Number.isFinite(quotedAtMs) || quotedAtMs <= 0) return true;
  return nowMs - quotedAtMs > maxAgeMs;
}

/**
 * Absolute deviation of a trade's effective execution price from the token's
 * spot price, in basis points. `spotPriceX18` is `token.currentPriceX18`
 * (native per token, 1e18-scaled), which the indexer maintains for curve trades
 * and DEX swaps alike. Returns `undefined` when the ratio is undefined.
 *
 * Informational only — nothing on chain enforces it. Call sites pass the
 * *curve-side* native amount, i.e. the amount that actually moved the reserves:
 * `ethInNet` on a buy, `ethOutNet + fee` on a sell. The Uniswap router exposes
 * no equivalent split, so the DEX figure also carries the router's 0.3%.
 */
export function priceImpactBps(
  ethWei: bigint,
  tokenWei: bigint,
  spotPriceX18: bigint
): number | undefined {
  if (ethWei < 0n || tokenWei <= 0n || spotPriceX18 <= 0n) return undefined;
  const executionX18 = (ethWei * 10n ** 18n) / tokenWei;
  const diff =
    executionX18 > spotPriceX18 ? executionX18 - spotPriceX18 : spotPriceX18 - executionX18;
  return Number((diff * 10_000n) / spotPriceX18);
}

// --- LCAI/USD ------------------------------------------------------------
// Every "$" figure in the app is a native amount times this price. It is read
// from a mainnet Uniswap V3 pool by useNativePrice; the maths lives here so it
// can be tested without a network.

/**
 * LCAI/USD derived from a Uniswap V3 LCAI/WETH pool's `slot0.sqrtPriceX96`
 * and an ETH/USD quote.
 *
 * `sqrtPriceX96` is `sqrt(token1 / token0) * 2**96` in raw units; both legs of
 * this pool are 18-decimal, so no decimal adjustment applies. `token0`/`token1`
 * are read from the pool rather than assumed — getting the orientation
 * backwards silently misprices the whole site by a factor of ~10^9, which is
 * exactly the class of made-up number this replaces.
 *
 * Returns `undefined` when the inputs cannot produce a real price: the pool is
 * not the configured LCAI/WETH pair, the feed answered zero or negative, or
 * the arithmetic went non-finite.
 */
export function lcaiUsdPrice(args: {
  sqrtPriceX96: bigint;
  token0: string;
  token1: string;
  lcai: string;
  weth: string;
  ethUsd: number;
}): number | undefined {
  const token0 = args.token0.toLowerCase();
  const token1 = args.token1.toLowerCase();
  const lcai = args.lcai.toLowerCase();
  const weth = args.weth.toLowerCase();

  const lcaiIsToken0 = token0 === lcai && token1 === weth;
  const lcaiIsToken1 = token1 === lcai && token0 === weth;
  if (!lcaiIsToken0 && !lcaiIsToken1) return undefined;
  if (args.sqrtPriceX96 <= 0n) return undefined;
  if (!Number.isFinite(args.ethUsd) || args.ethUsd <= 0) return undefined;

  const token1PerToken0 = (Number(args.sqrtPriceX96) / 2 ** 96) ** 2;
  const ethPerLcai = lcaiIsToken0 ? token1PerToken0 : 1 / token1PerToken0;
  if (!Number.isFinite(ethPerLcai) || ethPerLcai <= 0) return undefined;

  return args.ethUsd * ethPerLcai;
}

const usdAmount = (nativeAmount: number, priceUsd: number | undefined): number | undefined =>
  priceUsd === undefined || !Number.isFinite(priceUsd) || !Number.isFinite(nativeAmount)
    ? undefined
    : nativeAmount * priceUsd;

/**
 * USD text for a native (LCAI) amount, or an em dash while the price is
 * unknown. `priceUsd` is `undefined` until the mainnet read lands, and stays
 * `undefined` if it fails — there is deliberately no fallback constant,
 * because a plausible-looking invented dollar figure is worse than none.
 */
export function formatUsd(
  nativeAmount: number,
  priceUsd: number | undefined,
  options?: Intl.NumberFormatOptions
): string {
  const usd = usdAmount(nativeAmount, priceUsd);
  return usd === undefined ? "—" : `$${formatNumber(usd, options)}`;
}

/** `formatUsd` for a per-token price, so sub-cent values get the compact form. */
export function formatUsdPrice(nativeAmount: number, priceUsd: number | undefined): string {
  const usd = usdAmount(nativeAmount, priceUsd);
  return usd === undefined ? "—" : `$${formatPrice(usd)}`;
}

// --- small-price notation -------------------------------------------------
// A memecoin priced at 0.0000000495 is unreadable in full and misleading when
// truncated — `maximumFractionDigits: 8` renders it as "0". The exchange
// convention collapses the zero run into a subscript count, so the same value
// reads as 0.0₇495: "0.0", seven zeros, then the significant digits.

const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";

/** Shortest zero run worth collapsing. Below this, plain decimals read fine. */
const SUBSCRIPT_MIN_ZEROS = 4;

const toSubscript = (n: number): string =>
  String(n).replace(/\d/g, (d) => SUBSCRIPT_DIGITS[Number(d)]!);

/**
 * Format a price, collapsing a long run of leading zeros into a subscript:
 * `0.0000000495` -> `0.0₇495`, `0.00123456` -> `0.001235`.
 *
 * `significantDigits` counts the meaningful digits kept, not decimal places —
 * which is the point, since a price's magnitude is not known in advance.
 *
 * Built on `toExponential` rather than multiplying by a power of ten: the
 * float multiply reintroduces the very precision noise this exists to hide,
 * and `toExponential` carries the exponent correctly when rounding rolls
 * 9.99e-8 up to 1.00e-7.
 */
export function formatPrice(value: number, significantDigits = 4): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";

  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);

  const [mantissa = "", expPart = "0"] = abs.toExponential(significantDigits - 1).split("e");
  const exponent = Number(expPart);
  const zeros = -exponent - 1;

  if (zeros < SUBSCRIPT_MIN_ZEROS) {
    // Intl caps maximumFractionDigits at 20; `zeros` is bounded here so the
    // clamp only ever matters for large values, where 0 is what we want.
    const maxFractionDigits = Math.min(20, Math.max(0, significantDigits - 1 - exponent));
    return sign + formatNumber(abs, { maximumFractionDigits: maxFractionDigits });
  }

  const digits = mantissa.replace(".", "").replace(/0+$/, "") || "0";
  return `${sign}0.0${toSubscript(zeros)}${digits}`;
}
