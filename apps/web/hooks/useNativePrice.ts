"use client";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, fallback, formatUnits, http } from "viem";
import { mainnet } from "viem/chains";

import config from "@/config";
import { lcaiUsdPrice } from "@/lib/utils";

/** Chainlink's ETH/USD aggregator reports 8 decimals. */
const CHAINLINK_DECIMALS = 8;

/** LCAI/USD only drives display text, so a slow poll is plenty. */
export const NATIVE_PRICE_REFRESH_MS = 60_000;

/** Only the three views this needs — the full V3 pool ABI is ~40 entries. */
const poolAbi = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const aggregatorAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

// Do NOT drop these for a bare `http()`. viem's built-in mainnet endpoint is
// eth.merkle.io, which answers 403 behind Cloudflare from plenty of networks —
// the price would silently never load and every "$" would render "—". Set
// NEXT_PUBLIC_MAINNET_RPC_URL to a provider you control for anything
// user-facing; these two are a best-effort default so it works unconfigured.
const MAINNET_RPCS = process.env.NEXT_PUBLIC_MAINNET_RPC_URL
  ? [process.env.NEXT_PUBLIC_MAINNET_RPC_URL]
  : ["https://ethereum-rpc.publicnode.com", "https://1rpc.io/eth"];

// Ethereum mainnet, deliberately outside the wagmi/AppKit config: adding it
// there would list it in the network switcher as somewhere the user could
// trade, and nothing here needs a signer. Module-level — it depends on no
// React state, and constructing a client makes no request.
const mainnetClient = createPublicClient({
  chain: mainnet,
  transport: fallback(MAINNET_RPCS.map((url) => http(url))),
  batch: { multicall: true },
});

/**
 * LCAI/USD, or `undefined` while it is unknown.
 *
 * Every "$" figure in the app multiplies a native amount by this. Pass it to
 * `formatUsd`, which renders "—" for `undefined` — never substitute a constant
 * for a price that failed to load. React Query dedupes on the shared key, so
 * the five call sites cost one request between them.
 */
export default function useNativePrice(): number | undefined {
  const { data } = useQuery({
    queryKey: ["nativePrice"],
    queryFn: async () => {
      const { pool, lcai, weth, ethUsdAggregator } = config.priceFeed;
      const poolContract = { address: pool, abi: poolAbi } as const;

      // One multicall round trip: the client batches these.
      const [slot0, token0, token1, round] = await Promise.all([
        mainnetClient.readContract({ ...poolContract, functionName: "slot0" }),
        mainnetClient.readContract({ ...poolContract, functionName: "token0" }),
        mainnetClient.readContract({ ...poolContract, functionName: "token1" }),
        mainnetClient.readContract({
          address: ethUsdAggregator,
          abi: aggregatorAbi,
          functionName: "latestRoundData",
        }),
      ]);

      const price = lcaiUsdPrice({
        sqrtPriceX96: slot0[0],
        token0,
        token1,
        lcai,
        weth,
        // `answer` is int256 and can be negative if the feed misbehaves;
        // lcaiUsdPrice rejects anything <= 0.
        ethUsd: Number(formatUnits(round[1], CHAINLINK_DECIMALS)),
      });

      // Throw rather than return null so React Query retries and the UI keeps
      // showing "—" instead of caching a miss as a successful answer.
      if (price === undefined) {
        throw new Error("LCAI/USD unavailable — check config.priceFeed addresses");
      }
      return price;
    },
    refetchInterval: NATIVE_PRICE_REFRESH_MS,
    staleTime: NATIVE_PRICE_REFRESH_MS,
  });

  return data;
}
