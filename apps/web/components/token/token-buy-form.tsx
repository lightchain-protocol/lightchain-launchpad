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
import tokenQuery from "@/queries/tokenQuery";
import { formatNumber } from "@/lib/utils";

const AMOUNT_PRESETS = [0.1, 0.5, 1] as const;

export function TokenBuyForm() {
  const chain = useCurrentChain();
  const { quoteBuy, buyToken } = useTradeFunctions();
  const { quoteDexBuy, dexBuyToken } = useDexSwapFunctions();
  const { address } = useParams<{ address: string }>();
  const { data: token } = useSuspenseQuery(tokenQuery(address));
  const account = useConnection();
  const { open } = useAppKit();
  const queryClient = useQueryClient();

  const balance = useBalance({ enabled: !!account.address });
  const [ethIn, setEthIn] = useState("");
  const debouncedEthIn = useDebouncedValue(ethIn, 500);

  const quote = useQuery({
    queryKey: ["quoteBuy", token.address, debouncedEthIn, token.graduated],
    queryKeyHashFn: hashFn,
    queryFn: () =>
      token.graduated
        ? quoteDexBuy(token, debouncedEthIn).then((r) => ({ tokensOut: r.tokensOut }))
        : quoteBuy(token, debouncedEthIn),
    enabled: !!token.address && !!debouncedEthIn,
  });

  const insufficientAmount = useMemo(() => {
    if (!ethIn || !balance.data) return false;
    return Number(ethIn) > Number(formatEther(balance.data.value));
  }, [ethIn, balance.data]);

  const buyMutation = useMutation({
    mutationFn: () => (token.graduated ? dexBuyToken(token, ethIn) : buyToken(token, ethIn)),
    onSuccess: (hash) => {
      if (!hash) return;
      setEthIn("");
      toast.success("Buy transaction submitted");
      queryClient.invalidateQueries({ queryKey: ["balance", account.address, chain.id] });
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

  const expectedTokensOut = quote.data ? formatEther(quote.data.tokensOut) : undefined;

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
      amount={ethIn}
      onAmountChange={setEthIn}
      assetSymbol={chain.nativeCurrency.symbol}
      assetIconSrc="/images/brand/lcai.svg"
      balance={{ isLoading: balance.isLoading, formatted: balance.data?.formatted }}
      balanceSymbol={chain.nativeCurrency.symbol}
      insufficientAmount={insufficientAmount}
      amountPresets={[...AMOUNT_PRESETS]}
      onSubmit={onSubmit}
      submitDisabled={buyMutation.isPending || insufficientAmount}
      submitLabel={submitLabel}
      quoteLoading={quote.isLoading}
      quoteText={
        expectedTokensOut && (
          <span>
            You will receive: {formatNumber(expectedTokensOut, { maximumFractionDigits: 6 })} {token.symbol}
          </span>
        )
      }
    />
  );
}
