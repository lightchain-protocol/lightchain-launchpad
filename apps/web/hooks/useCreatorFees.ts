import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection } from "wagmi";
import { formatEther } from "viem";
import { toast } from "sonner";

import useContracts from "./useContracts";
import useCurrentChain from "./useCurrentChain";
import useWeb3Clients from "./useWeb3Clients";

/**
 * Creator fee balance + claim for one token.
 *
 * The launchpad accrues the creator's share of every trade fee (and of the
 * graduation fee) into per-token `creatorFees`, claimable only by
 * `creatorOf[token]`. It is live contract state, not indexed, so it is read
 * on-chain rather than from the API.
 *
 * Pass `enabled: false` for viewers who aren't the creator — the claim would
 * revert `Unauthorized` anyway, and there's nothing to show them.
 */
export default function useCreatorFees(
  token: `0x${string}` | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { address } = useConnection();
  const chain = useCurrentChain();
  const { launchpadContract } = useContracts();
  const { publicClient, walletClient } = useWeb3Clients();
  const queryClient = useQueryClient();

  const queryKey = ["creatorFees", chain.id, token, address] as const;

  const claimable = useQuery({
    queryKey,
    queryFn: async () => {
      const value = await launchpadContract.read.creatorFeesOf([token!]);
      return { value, formatted: formatEther(value) };
    },
    enabled: enabled && !!token && !!address,
  });

  const claim = useMutation({
    mutationFn: async (): Promise<`0x${string}` | undefined> => {
      if (!walletClient || !token || !address) return;
      // claim to the creator's own wallet — the contract accepts any
      // destination, but a picker here would be surface without a use case
      const { request } = await launchpadContract.simulate.claimCreatorFees([token, address], {
        account: address,
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      return hash;
    },
    onSuccess: (hash) => {
      if (!hash) return;
      toast.success("Creator fees claimed");
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["balance", address, chain.id] });
    },
    onError: (error: {
      walk?: () => { shortMessage?: string; message?: string };
      message?: string;
    }) => {
      toast.error(
        error?.walk?.()?.shortMessage || error?.walk?.()?.message || error?.message || "Claim failed",
      );
    },
  });

  return { claimable, claim };
}
