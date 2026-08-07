import hre from "hardhat";
import type { Chain } from "viem";

import { lcaiTestnet } from "../chains/lcaiTestnet";

/** Chains hardhat-viem can't resolve on its own, keyed by the id it reads from the node. */
const CUSTOM: Chain[] = [lcaiTestnet];

/**
 * hardhat-viem resolves the chain by looking up `viem/chains` by id, and throws
 * NetworkNotFoundError for anything that registry doesn't ship — LCAI is 8200.
 * There is no config hook for custom chains, so every client getter has to be
 * handed one explicitly. Spread the result into the getters:
 *
 *   const publicClient = await hre.viem.getPublicClient(chainOpts());
 *
 * Returns an EMPTY object for chains viem already knows (hardhat, localhost) —
 * never `{ chain: undefined }`. The getters resolve `config?.chain ??
 * getChain(provider)` but then spread that same config into createWalletClient
 * *after* setting `chain`, so an explicit undefined overwrites the chain they
 * just detected and every transaction fails with ChainNotFoundError.
 */
export function chainOpts(): { chain?: Chain } {
  const chain = CUSTOM.find((c) => c.id === hre.network.config.chainId);
  return chain ? { chain } : {};
}
