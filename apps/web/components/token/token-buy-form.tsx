"use client";

import { FormEvent, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { hashFn } from "wagmi/query";
import { useConnection } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { formatEther } from "viem";
import { toast } from "sonner";

import { TokenTradeFormShell } from "@/components/token/token-trade-form-shell";
import { useBalance } from "@/hooks/useBalance";
import useCurrentChain from "@/hooks/useCurrentChain";
import useDexSwapFunctions from "@/hooks/useDexSwapFunctions";
import useTradeFunctions from "@/hooks/useTradeFunctions";
import { useDebouncedValue } from "@/hooks/useDebounce";
import { ipfsToHttp } from "@/lib/ipfs";
import tokenQuery from "@/queries/tokenQuery";
import { formatNumber } from "@/lib/utils";

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

  const quote = useQuery({
    queryKey: ["quoteBuy", token.address, debouncedAmount, token.graduated, inputMode],
    queryKeyHashFn: hashFn,
    queryFn: async () => {
      if (isTokenMode) {
        const result = token.graduated
          ? await quoteDexBuyForTokens(token, debouncedAmount)
          : await quoteBuyForTokens(token, debouncedAmount);
        return { ethIn: result.ethIn, tokensOut: result.tokensOut };
      }
      const result = token.graduated
        ? await quoteDexBuy(token, debouncedAmount).then((r) => ({ tokensOut: r.tokensOut }))
        : await quoteBuy(token, debouncedAmount);
      return { ethIn: undefined as bigint | undefined, tokensOut: result.tokensOut };
    },
    enabled: !!token.address && !!debouncedAmount,
  });

  const ethCost = useMemo(() => {
    if (isTokenMode) {
      return quote.data?.ethIn !== undefined ? formatEther(quote.data.ethIn) : undefined;
    }
    return amount || undefined;
  }, [isTokenMode, quote.data?.ethIn, amount]);

  const insufficientAmount = useMemo(() => {
    if (!ethCost || !balance.data) return false;
    return Number(ethCost) > Number(formatEther(balance.data.value));
  }, [ethCost, balance.data]);

  const buyMutation = useMutation({
    mutationFn: () => {
      if (isTokenMode) {
        return token.graduated
          ? dexBuyTokenForTokens(token, amount)
          : buyTokenForTokens(token, amount);
      }
      return token.graduated ? dexBuyToken(token, amount) : buyToken(token, amount);
    },
    onSuccess: (hash) => {
      if (!hash) return;
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

  const expectedTokensOut =
    !isTokenMode && quote.data?.tokensOut !== undefined
      ? formatEther(quote.data.tokensOut)
      : undefined;

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
      submitDisabled={buyMutation.isPending || insufficientAmount || !amount}
      submitLabel={submitLabel}
      quoteLoading={quote.isLoading}
      quoteText={
        isTokenMode
          ? ethCost && (
              <span>
                Cost: {formatNumber(ethCost, { maximumFractionDigits: 6 })} {nativeSymbol}
              </span>
            )
          : expectedTokensOut && (
              <span>
                You will receive: {formatNumber(expectedTokensOut, { maximumFractionDigits: 6 })}{" "}
                {token.symbol}
              </span>
            )
      }
    />
  );
}
