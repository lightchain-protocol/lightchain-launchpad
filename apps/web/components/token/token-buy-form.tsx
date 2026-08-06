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
import {
  applySlippage,
  formatNumber,
  isQuoteStale,
  priceImpactBps,
  QUOTE_REFRESH_MS,
} from "@/lib/utils";
import useUserStore from "@/store/user-store";

const AMOUNT_PRESETS = [0.1, 0.5, 1] as const;

type BuyInputMode = "native" | "token";

export function TokenBuyForm() {
  const chain = useCurrentChain();
  const { quoteBuy, quoteBuyForTokens, buyToken, buyTokenForTokens } = useTradeFunctions();
  const { quoteDexBuy, quoteDexBuyForTokens, dexBuyToken, dexBuyTokenForTokens } = useDexSwapFunctions();
  const { address } = useParams<{ address: string }>();
  const { data: token } = useSuspenseQuery(tokenQuery(address));
  const account = useConnection();
  const { open } = useAppKit();
  const queryClient = useQueryClient();

  const balance = useBalance({ enabled: !!account.address });
  const [inputMode, setInputMode] = useState<BuyInputMode>("native");
  const [amount, setAmount] = useState("");
  const debouncedAmount = useDebouncedValue(amount, 500);

  const nativeSymbol = chain.nativeCurrency.symbol;
  const tokenIconSrc = ipfsToHttp(token.metadata.imageUrl) || "/images/card/card-img-sm-1.png";
  const isTokenMode = inputMode === "token";

  const { slippageTolerance } = useUserStore();

  const quote = useQuery({
    queryKey: ["quoteBuy", token.address, debouncedAmount, token.graduated, inputMode],
    queryKeyHashFn: hashFn,
    queryFn: async (): Promise<{ ethIn?: bigint; ethNet: bigint; tokensOut: bigint }> => {
      if (isTokenMode) {
        if (token.graduated) {
          const r = await quoteDexBuyForTokens(token, debouncedAmount);
          return { ethIn: r.ethIn, ethNet: r.ethIn, tokensOut: r.tokensOut };
        }
        const r = await quoteBuyForTokens(token, debouncedAmount);
        return { ethIn: r.ethIn, ethNet: r.ethInNet, tokensOut: r.tokensOut };
      }
      if (token.graduated) {
        const r = await quoteDexBuy(token, debouncedAmount);
        return { ethIn: undefined, ethNet: parseEther(debouncedAmount), tokensOut: r.tokensOut };
      }
      const r = await quoteBuy(token, debouncedAmount);
      return { ethIn: undefined, ethNet: r.ethInNet, tokensOut: r.tokensOut };
    },
    enabled: !!token.address && !!debouncedAmount,
    // The displayed figure is the slippage anchor, so it must not go stale while
    // the user reads it. `staleTime: 0` overrides the client-wide 60 s default in
    // app/get-query-client.ts. The interval stops firing while the tab is
    // unfocused (refetchIntervalInBackground defaults to false) and that client
    // also sets refetchOnWindowFocus: false — so a backgrounded tab is caught by
    // the QUOTE_MAX_AGE_MS check in the mutation, not by a refetch on return.
    staleTime: 0,
    refetchInterval: QUOTE_REFRESH_MS,
  });

  /** The quote on screen belongs to `debouncedAmount`; it only anchors `amount` when they agree. */
  const quoteReady = !!quote.data && debouncedAmount === amount;

  const minReceived = useMemo(
    () =>
      isTokenMode || !quote.data
        ? undefined
        : applySlippage(quote.data.tokensOut, "min", slippageTolerance),
    [isTokenMode, quote.data, slippageTolerance],
  );

  const maxCost = useMemo(
    () =>
      !isTokenMode || quote.data?.ethIn === undefined
        ? undefined
        : applySlippage(quote.data.ethIn, "max", slippageTolerance),
    [isTokenMode, quote.data, slippageTolerance],
  );

  const impactBps = useMemo(
    () =>
      quote.data
        ? priceImpactBps(quote.data.ethNet, quote.data.tokensOut, BigInt(token.currentPriceX18))
        : undefined,
    [quote.data, token.currentPriceX18],
  );

  const ethCost = useMemo(() => {
    if (isTokenMode) {
      return maxCost !== undefined ? formatEther(maxCost) : undefined;
    }
    return amount || undefined;
  }, [isTokenMode, maxCost, amount]);

  const insufficientAmount = useMemo(() => {
    if (!ethCost || !balance.data) return false;
    return Number(ethCost) > Number(formatEther(balance.data.value));
  }, [ethCost, balance.data]);

  const buyMutation = useMutation({
    mutationFn: async () => {
      const q = quote.data;
      if (!q || debouncedAmount !== amount) {
        throw new Error("Quote not ready — wait a moment and try again");
      }
      if (isQuoteStale(quote.dataUpdatedAt)) {
        void quote.refetch();
        throw new Error("Quote expired — review the refreshed amount and try again");
      }
      if (isTokenMode) {
        if (q.ethIn === undefined) throw new Error("Quote not ready — wait a moment and try again");
        return token.graduated
          ? dexBuyTokenForTokens(token, amount, q.ethIn)
          : buyTokenForTokens(token, amount, q.ethIn);
      }
      return token.graduated
        ? dexBuyToken(token, amount, q.tokensOut)
        : buyToken(token, amount, q.tokensOut);
    },
    onSuccess: () => {
      setAmount("");
      toast.success("Buy confirmed");
      void queryClient.invalidateQueries({ queryKey: ["balance", account.address, chain.id] });
    },
    onError: (error: { walk?: () => { shortMessage?: string; message?: string }; message?: string }) => {
      toast.error(error?.walk?.()?.shortMessage || error?.walk?.()?.message || error?.message || "Buy failed");
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!account.address) return open();
    buyMutation.mutate();
  };

  const onSwitchInput = () => {
    setInputMode((mode) => (mode === "native" ? "token" : "native"));
    setAmount("");
  };

  const submitLabel = account.address ? (
    buyMutation.isPending ? (
      <Loader2 className="mx-auto size-5 animate-spin" />
    ) : (
      "Buy"
    )
  ) : (
    "Connect Wallet"
  );

  return (
    <TokenTradeFormShell
      amount={amount}
      onAmountChange={setAmount}
      assetSymbol={isTokenMode ? token.symbol : nativeSymbol}
      assetIconSrc={isTokenMode ? tokenIconSrc : "/images/brand/lcai.svg"}
      balance={{ isLoading: balance.isLoading, formatted: balance.data?.formatted }}
      balanceSymbol={nativeSymbol}
      insufficientAmount={insufficientAmount}
      amountPresets={isTokenMode ? undefined : [...AMOUNT_PRESETS]}
      onSwitchInput={onSwitchInput}
      onSubmit={onSubmit}
      submitDisabled={buyMutation.isPending || insufficientAmount || !amount || !quoteReady}
      submitLabel={submitLabel}
      quoteLoading={quote.isLoading}
      quoteText={
        quote.data && (
          <>
            <span className="block">
              {isTokenMode
                ? `Cost: ${formatNumber(formatEther(quote.data.ethIn ?? 0n), { maximumFractionDigits: 6 })} ${nativeSymbol}`
                : `You will receive: ${formatNumber(formatEther(quote.data.tokensOut), { maximumFractionDigits: 6 })} ${token.symbol}`}
            </span>
            <span className="block">
              {isTokenMode
                ? `Maximum cost: ${formatNumber(formatEther(maxCost ?? 0n), { maximumFractionDigits: 6 })} ${nativeSymbol}`
                : `Minimum received: ${formatNumber(formatEther(minReceived ?? 0n), { maximumFractionDigits: 6 })} ${token.symbol}`}
            </span>
            {impactBps !== undefined && (
              <span className="block">Price impact: {(impactBps / 100).toFixed(2)}%</span>
            )}
          </>
        )
      }
    />
  );
}
