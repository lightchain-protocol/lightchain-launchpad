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
    [lcaiTestnet.id]: "0xe47f247a2249961b27eb1d6324d90972b320c29b",
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
};

export default config;
