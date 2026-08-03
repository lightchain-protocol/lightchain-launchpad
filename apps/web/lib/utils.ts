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
