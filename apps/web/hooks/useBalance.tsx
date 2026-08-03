import { useQuery } from "@tanstack/react-query";
import { useConnection } from "wagmi";
import useWeb3Clients from "./useWeb3Clients";
import useCurrentChain from "./useCurrentChain";
import { erc20Abi, formatEther } from "viem";

type Props = Partial<{
  token: `0x${string}`;
  enabled: boolean;
}>;

export const useBalance = ({ token, enabled }: Props = {}) => {
  const { address } = useConnection();
  const { publicClient } = useWeb3Clients();
  const chain = useCurrentChain();

  return useQuery({
    queryKey: ["balance", address, chain.id, token],
    queryFn: async () => {
      if (!address) return undefined;
      if (token) {
        const value = await publicClient.readContract({
          abi: erc20Abi,
          address: token,
          functionName: "balanceOf",
          args: [address],
        });

        const formatted = formatEther(value);
        return { value, formatted };
      } else {
        const value = await publicClient.getBalance({ address });
        const formatted = formatEther(value);

        return { value, formatted };
      }
    },
    enabled: !!address && enabled,
  });
};
