import { Chain, localhost } from "viem/chains";
import { lcai, lcaiTestnet } from "./chains";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

const localLaunchpad = (process.env.NEXT_PUBLIC_LAUNCHPAD_ADDRESS ?? ZERO) as `0x${string}`;
const localRouter = (process.env.NEXT_PUBLIC_UNISWAP_V2_ROUTER ?? ZERO) as `0x${string}`;
const localWeth = (process.env.NEXT_PUBLIC_WETH_ADDRESS ?? ZERO) as `0x${string}`;

/** When true (set by `make deploy` / sync-env), expose Anvil as the default chain. */
const enableLocalhost = process.env.NEXT_PUBLIC_ENABLE_LOCALHOST === "true";

/**
 * `launchpad` is the monolithic proxy address (UUPS) that owns every bonding
 * curve, trading and graduation path. Per-chain addresses are filled in after
 * deploy. Local Anvil addresses come from `NEXT_PUBLIC_*` (see `make deploy`).
 * The Uniswap V2 router address is also readable on-chain via `dexRouter()`;
 * pre-graduation trading goes through the launchpad and post-graduation swaps
 * go through that router.
 */
const config = {
  chains: (enableLocalhost ? [localhost, lcaiTestnet] : [lcaiTestnet]) as [Chain, ...Chain[]],

  launchpad: {
    [localhost.id]: localLaunchpad,
    [lcaiTestnet.id]: "0xbd0cb79733c8cc055fc0720d30c16b6dfbd69158",
    [lcai.id]: ZERO,
  } as Record<number, `0x${string}`>,

  uniswapV2Router: {
    [localhost.id]: localRouter,
    [lcaiTestnet.id]: "0xBA502917c3F7233F9100f9430f4048a224A7D8DE",
    [lcai.id]: ZERO,
  } as Record<number, `0x${string}`>,

  weth: {
    [localhost.id]: localWeth,
    [lcaiTestnet.id]: "0x89bFfFFb1Ca7821b7230a6a7479Fa93A7bDd7c16",
    [lcai.id]: ZERO,
  } as Record<number, `0x${string}`>,

  /**
   * LCAI/USD is read from **Ethereum mainnet**, not from the chain the app is
   * connected to: LCAI is the native gas token here, so there is no pool on
   * this chain to price it against. The Uniswap V3 LCAI/WETH pool gives ETH
   * per LCAI and Chainlink's ETH/USD feed converts that to dollars — the same
   * two contracts the LCAI DAO app reads. Not per-chain: these are the same
   * addresses whether the user is on testnet, mainnet or local Anvil.
   */
  priceFeed: {
    pool: "0x0D047a370611437a1B8e6c2a95eA36f69fdDa3Be",
    lcai: "0x9ca8530ca349c966fe9ef903df17a75b8a778927",
    weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    ethUsdAggregator: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  } as Record<"pool" | "lcai" | "weth" | "ethUsdAggregator", `0x${string}`>,
};

export default config;
