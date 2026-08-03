import { useMemo } from "react";
import { getContract } from "viem";

import config from "@/config";
import { launchpadAbi, uniswapV2Router02Abi } from "@lcai/abis";
import useCurrentChain from "./useCurrentChain";
import useWeb3Clients from "./useWeb3Clients";

const useContracts = () => {
  const chain = useCurrentChain();
  const { publicClient, walletClient } = useWeb3Clients();

  const client = useMemo(
    () => ({ public: publicClient, wallet: walletClient }),
    [publicClient, walletClient],
  );

  const launchpadContract = useMemo(
    () =>
      getContract({
        abi: launchpadAbi,
        address: config.launchpad[chain.id]!,
        client,
      }),
    [chain, client],
  );

  const uniswapV2RouterContract = useMemo(
    () =>
      getContract({
        abi: uniswapV2Router02Abi,
        address: config.uniswapV2Router[chain.id]!,
        client,
      }),
    [chain, client],
  );

  return { launchpadContract, uniswapV2RouterContract };
};

export default useContracts;
