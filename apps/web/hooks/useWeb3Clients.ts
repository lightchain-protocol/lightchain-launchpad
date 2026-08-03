import { useWalletClient } from "wagmi";
import useCurrentChain from "./useCurrentChain";
import { useMemo } from "react";
import { createPublicClient, http } from "viem";

const useWeb3Clients = () => {
  const chain = useCurrentChain();
  const { data: walletClient } = useWalletClient();

  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain,
        transport: http(),
        // batch: { multicall: true },
      }),
    [chain]
  );

  return { publicClient, walletClient };
};

export default useWeb3Clients;
