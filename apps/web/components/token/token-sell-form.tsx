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

  const quote = useQuery({
    queryKey: ["quoteSell", token.address, debouncedTokenIn, token.graduated],
    queryKeyHashFn: hashFn,
    queryFn: () =>
      token.graduated
        ? quoteDexSell(token, debouncedTokenIn).then((r) => ({ ethOutNet: r.ethOut }))
        : quoteSell(token, debouncedTokenIn),
    enabled: !!token.address && !!debouncedTokenIn,
  });

  const insufficientAmount = useMemo(() => {
    if (!tokenIn || !tokenBalance.data) return false;
    return Number(tokenIn) > Number(formatEther(tokenBalance.data.value));
  }, [tokenIn, tokenBalance.data]);

  const sellMutation = useMutation({
    mutationFn: () => (token.graduated ? dexSellToken(token, tokenIn) : sellToken(token, tokenIn)),
    onSuccess: (hash) => {
      if (!hash) return;
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

  const expectedEthOut = quote.data ? formatEther(quote.data.ethOutNet) : undefined;
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
      submitDisabled={sellMutation.isPending || insufficientAmount}
      submitLabel={submitLabel}
      quoteLoading={quote.isLoading}
      quoteText={
        expectedEthOut && (
          <span>
            You will receive: {formatNumber(expectedEthOut, { maximumFractionDigits: 6 })} {chain.nativeCurrency.symbol}
          </span>
        )
      }
    />
  );
}
