import config from "@/config";
import { useMemo } from "react";
import { useChainId } from "wagmi";

const useCurrentChain = () => {
  const chainId = useChainId();

  return useMemo(() => config.chains.find((chain) => chain.id === chainId) || config.chains[0], [chainId]);
};

export default useCurrentChain;
