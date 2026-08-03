import { Chain, localhost } from "viem/chains";
import { lcai, lcaiTestnet } from "./chains";

/**
 * `launchpad` is the monolithic proxy address (UUPS) that owns every bonding
 * curve, trading and graduation path. Per-chain addresses are filled in after
 * `pnpm deploy:proxy` from the contracts package. The Uniswap V2 router address
 * is read on-chain via `dexRouter()`; pre-graduation trading goes through the
 * launchpad and post-graduation swaps go through that router.
 */
const config = {
  chains: [lcaiTestnet] as [Chain, ...Chain[]],

  launchpad: {
    [localhost.id]: "0x0000000000000000000000000000000000000000",
    [lcaiTestnet.id]: "0xe47f247a2249961b27eb1d6324d90972b320c29b",
    [lcai.id]: "0x0000000000000000000000000000000000000000",
  } as Record<number, `0x${string}`>,

  uniswapV2Router: {
    [localhost.id]: "0x0000000000000000000000000000000000000000",
    [lcaiTestnet.id]: "0xBA502917c3F7233F9100f9430f4048a224A7D8DE",
    [lcai.id]: "0x0000000000000000000000000000000000000000",
  } as Record<number, `0x${string}`>,

  weth: {
    [localhost.id]: "0x0000000000000000000000000000000000000000",
    [lcaiTestnet.id]: "0x89bFfFFb1Ca7821b7230a6a7479Fa93A7bDd7c16",
    [lcai.id]: "0x0000000000000000000000000000000000000000",
  } as Record<number, `0x${string}`>,
};

export default config;
