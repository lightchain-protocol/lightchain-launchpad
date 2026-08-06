"use client";

import { FormEvent, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { hashFn } from "wagmi/query";
import { useConnection } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { formatEther, parseEther } from "viem";
import { toast } from "sonner";

import { TokenTradeFormShell } from "@/components/token/token-trade-form-shell";
import { useBalance } from "@/hooks/useBalance";
import useCurrentChain from "@/hooks/useCurrentChain";
import useDexSwapFunctions from "@/hooks/useDexSwapFunctions";
import useTradeFunctions from "@/hooks/useTradeFunctions";
import { useDebouncedValue } from "@/hooks/useDebounce";
import { ipfsToHttp } from "@/lib/ipfs";
import tokenQuery from "@/queries/tokenQuery";
import { applySlippage, formatNumber, isQuoteStale, priceImpactBps, QUOTE_REFRESH_MS } from "@/lib/utils";
import useUserStore from "@/store/user-store";

const PERCENTAGE_PRESETS = [25, 50, 75, 100] as const;

export function TokenSellForm() {
  const chain = useCurrentChain();
  const { quoteSell, sellToken } = useTradeFunctions();
  const { quoteDexSell, dexSellToken } = useDexSwapFunctions();
  const { address } = useParams<{ address: string }>();
  const { data: token } = useSuspenseQuery(tokenQuery(address));
  const account = useConnection();
  const { open } = useAppKit();
  const queryClient = useQueryClient();

  const [tokenIn, setTokenIn] = useState("");
  const debouncedTokenIn = useDebouncedValue(tokenIn, 500);

  const tokenBalance = useBalance({
    token: token?.address,
    enabled: !!token?.address && !!account.address,
  });

  const { slippageTolerance } = useUserStore();

  const quote = useQuery({
    queryKey: ["quoteSell", token.address, debouncedTokenIn, token.graduated],
    queryKeyHashFn: hashFn,
    queryFn: async (): Promise<{ ethOutNet: bigint; ethGross: bigint }> => {
      if (token.graduated) {
        const r = await quoteDexSell(token, debouncedTokenIn);
        return { ethOutNet: r.ethOut, ethGross: r.ethOut };
      }
      const r = await quoteSell(token, debouncedTokenIn);
      return { ethOutNet: r.ethOutNet, ethGross: r.ethOutNet + r.fee };
    },
    enabled: !!token.address && !!debouncedTokenIn,
    staleTime: 0,
    refetchInterval: QUOTE_REFRESH_MS,
  });

  const quoteReady = !!quote.data && debouncedTokenIn === tokenIn;

  const minReceived = useMemo(
    () => (quote.data ? applySlippage(quote.data.ethOutNet, "min", slippageTolerance) : undefined),
    [quote.data, slippageTolerance]
  );

  const impactBps = useMemo(
    () =>
      quote.data && debouncedTokenIn
        ? priceImpactBps(quote.data.ethGross, parseEther(debouncedTokenIn), BigInt(token.currentPriceX18))
        : undefined,
    [quote.data, debouncedTokenIn, token.currentPriceX18]
  );

  const insufficientAmount = useMemo(() => {
    if (!tokenIn || !tokenBalance.data) return false;
    return Number(tokenIn) > Number(formatEther(tokenBalance.data.value));
  }, [tokenIn, tokenBalance.data]);

  const sellMutation = useMutation({
    mutationFn: async () => {
      const q = quote.data;
      if (!q || debouncedTokenIn !== tokenIn) {
        throw new Error("Quote not ready — wait a moment and try again");
      }
      if (isQuoteStale(quote.dataUpdatedAt)) {
        void quote.refetch();
        throw new Error("Quote expired — review the refreshed amount and try again");
      }
      return token.graduated ? dexSellToken(token, tokenIn, q.ethOutNet) : sellToken(token, tokenIn, q.ethOutNet);
    },
    onSuccess: () => {
      setTokenIn("");
      toast.success("Sell confirmed");
      // Prefix match refreshes native + ERC-20 balances for this account/chain.
      void queryClient.invalidateQueries({ queryKey: ["balance", account.address, chain.id] });
    },
    onError: (error: { walk?: () => { shortMessage?: string; message?: string }; message?: string }) => {
      toast.error(error?.walk?.()?.shortMessage || error?.walk?.()?.message || error?.message || "Sell failed");
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!account.address) return open();
    sellMutation.mutate();
  };

  const onPercentagePreset = (percentage: number) => {
    if (!tokenBalance.data?.value) return;
    const amount = (tokenBalance.data.value * BigInt(percentage)) / 100n;
    setTokenIn(formatEther(amount));
  };

  const tokenIconSrc = ipfsToHttp(token.metadata.imageUrl) || "/images/card/card-img-sm-1.png";

  const submitLabel = account.address ? (
    sellMutation.isPending ? (
      <Loader2 className="mx-auto size-5 animate-spin" />
    ) : (
      "Sell"
    )
  ) : (
    "Connect Wallet"
  );

  return (
    <TokenTradeFormShell
      amount={tokenIn}
      onAmountChange={setTokenIn}
      assetSymbol={token.symbol}
      assetIconSrc={tokenIconSrc}
      balance={{ isLoading: tokenBalance.isLoading, formatted: tokenBalance.data?.formatted }}
      balanceSymbol={token.symbol}
      insufficientAmount={insufficientAmount}
      percentagePresets={[...PERCENTAGE_PRESETS]}
      onPercentagePreset={onPercentagePreset}
      onSubmit={onSubmit}
      submitDisabled={sellMutation.isPending || insufficientAmount || !tokenIn || !quoteReady}
      submitLabel={submitLabel}
      quoteLoading={quote.isLoading}
      quoteText={
        quote.data && (
          <>
            <span className="block">
              You will receive: {formatNumber(formatEther(quote.data.ethOutNet), { maximumFractionDigits: 6 })}{" "}
              {chain.nativeCurrency.symbol}
            </span>
            {/* <span className="block">
              Minimum received:{" "}
              {formatNumber(formatEther(minReceived ?? 0n), { maximumFractionDigits: 6 })}{" "}
              {chain.nativeCurrency.symbol}
            </span> */}
            {/* {impactBps !== undefined && (
              <span className="block">Price impact: {(impactBps / 100).toFixed(2)}%</span>
            )} */}
          </>
        )
      }
    />
  );
}
