"use client";

import { useParams } from "next/navigation";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useConnection } from "wagmi";
import { Loader2 } from "lucide-react";

import useCreatorFees from "@/hooks/useCreatorFees";
import useCurrentChain from "@/hooks/useCurrentChain";
import tokenQuery from "@/queries/tokenQuery";
import { formatNumber } from "@/lib/utils";
import { Button } from "@lcai/ui/components/button";

/**
 * Shown only to the token's creator. Renders nothing for everyone else — the
 * on-chain claim is gated on `creatorOf[token]`, so there is nothing here for
 * a visitor to act on.
 */
export function CreatorFeesCard() {
  const { address: tokenAddress } = useParams<{ address: string }>();
  const { data: token } = useSuspenseQuery(tokenQuery(tokenAddress));
  const { address } = useConnection();
  const chain = useCurrentChain();

  const isCreator = !!address && address.toLowerCase() === token.creator.toLowerCase();
  const { claimable, claim } = useCreatorFees(token.address, { enabled: isCreator });

  if (!isCreator) return null;

  const amount = claimable.data?.value ?? 0n;
  const nothingToClaim = amount === 0n;

  return (
    <div className="bg-flashlight space-y-3 rounded-xl border border-border/60 bg-card p-4">
      <h4 className="flex items-baseline justify-between gap-2 text-sm font-medium">
        Your Creator Fees
        <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
          Creator
        </span>
      </h4>

      <p className="text-xl font-bold tracking-tight tabular-nums">
        {claimable.isLoading ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          formatNumber(claimable.data?.formatted, { maximumFractionDigits: 8 })
        )}
        <span className="ml-1 text-sm font-semibold text-muted-foreground">
          {chain.nativeCurrency.symbol}
        </span>
      </p>

      <Button
        className="w-full"
        disabled={nothingToClaim || claimable.isLoading || claim.isPending}
        onClick={() => claim.mutate()}
      >
        {claim.isPending ? <Loader2 className="mx-auto size-5 animate-spin" /> : "Claim"}
      </Button>

      <p className="text-xs text-muted-foreground">
        {nothingToClaim
          ? "You earn a share of every trade fee on this token, plus a cut of the graduation fee."
          : "Claimed to your connected wallet."}
      </p>
    </div>
  );
}
