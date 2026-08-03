"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Check, Copy, Globe, Send } from "lucide-react";
import { formatEther } from "viem";

import { TokenChart } from "@/components/charts/token-chart";
import { TokenHolderTable } from "@/components/token/token-holder-table";
import { TokenTradePanel } from "@/components/token/token-trade-panel";
import { TokenTradeTable } from "@/components/token/token-trade-table";
import { $http } from "@/lib/http";
import dayjs from "@/lib/dayjs";
import { ipfsToHttp, weiToNative } from "@/lib/ipfs";
import { formatNumber, normalizeTokenAddress } from "@/lib/utils";
import tokenQuery from "@/queries/tokenQuery";
import useCurrentChain from "@/hooks/useCurrentChain";
import { useRealtimeRoom, useSocketIOEvent } from "@/hooks/useSocketIoEvent";
import useStore from "@/store";
import type {
  Paginated,
  Token,
  TokenDetail,
  TokenGraduatedPayload,
  TokenUpdatePayload,
  Trade,
  TradeEventPayload,
} from "@/types";
import { Card, CardContent } from "@lcai/ui/components/card";
import { Progress } from "@lcai/ui/components/progress";
import { cn } from "@lcai/ui/lib/utils";

function applyTradeToTokenDetail(old: TokenDetail, dto: Token, trade: Trade): TokenDetail {
  return {
    ...old,
    realEthRaised: dto.realEthRaised,
    tokensSold: dto.tokensSold,
    currentPriceX18: dto.currentPriceX18,
    priceNative: dto.priceNative,
    marketCap: dto.marketCap,
    progressBps: dto.progressBps,
    graduated: dto.graduated,
    pair: dto.pair,
    tradeCount: dto.tradeCount,
    volumeNative: dto.volumeNative,
    lastTradeAt: dto.lastTradeAt,
    volumeTotal: (BigInt(old.volumeTotal) + BigInt(trade.ethAmount)).toString(),
  };
}

function StatCard({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("bg-flashlight rounded-xl border border-border/60 bg-card p-4", className)}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

export function TokenDetails() {
  const chain = useCurrentChain();
  const [isCopied, setIsCopied] = useState(false);
  const { nativePrice } = useStore();
  const queryClient = useQueryClient();

  const { address: rawAddress } = useParams<{ address: string }>();
  const address = normalizeTokenAddress(rawAddress);
  const { data: token } = useSuspenseQuery(tokenQuery(address));

  useRealtimeRoom(`token:${address}`);

  const { data: trades } = useQuery({
    queryKey: ["trades", address],
    queryFn: () => $http.$get<Paginated<Trade>>(`/tokens/${address}/trades`).then((res) => res.data),
  });

  const priceUSD = token.priceNative * nativePrice;
  const marketCapUSD = weiToNative(token.marketCap) * nativePrice;
  const liquidityUSD = weiToNative(token.virtualEthReserve) * nativePrice;
  const volume24hNative = weiToNative(token.volume24h);
  const fundingRaisedNative = weiToNative(token.realEthRaised);
  const fundingGoalNative = weiToNative(token.fundingGoal);

  const bondingCurvePercentage = useMemo(() => Math.min(100, token.progressBps / 100), [token.progressBps]);

  const remainingForSaleNative = useMemo(() => {
    try {
      const max = BigInt(token.maxSupplyForSale);
      const sold = BigInt(token.tokensSold);
      return Number(formatEther(max - sold));
    } catch {
      return 0;
    }
  }, [token.maxSupplyForSale, token.tokensSold]);

  const imageUrl = ipfsToHttp(token.metadata.imageUrl);
  const bannerUrl = ipfsToHttp(token.metadata.bannerUrl) ?? imageUrl;

  const handleCopy = () => {
    navigator.clipboard.writeText(token.address).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  useSocketIOEvent<TradeEventPayload>(
    (data) => {
      if (normalizeTokenAddress(data.token) !== address) return;
      queryClient.setQueryData(["trades", address], (old: Trade[] | undefined) =>
        old ? [data.trade, ...old] : [data.trade]
      );
      queryClient.setQueryData(["token", address], (old: TokenDetail | undefined) =>
        old ? applyTradeToTokenDetail(old, data.tokenDTO, data.trade) : old
      );
    },
    { eventName: "trade" },
    [address, queryClient]
  );

  useSocketIOEvent<TokenUpdatePayload>(
    (data) => {
      if (normalizeTokenAddress(data.address) !== address) return;
      queryClient.setQueryData(["token", address], (old: TokenDetail | undefined) =>
        old
          ? ({
              ...old,
              priceNative: data.priceNative,
              currentPriceX18: data.priceX18,
              marketCap: data.marketCap,
              realEthRaised: data.realEthRaised,
              tokensSold: data.tokensSold,
              progressBps: data.progressBps,
              graduated: data.graduated,
              lastTradeAt: data.lastTradeAt,
            } as TokenDetail)
          : old
      );
    },
    { eventName: "token:update" },
    [address, queryClient]
  );

  useSocketIOEvent<TokenGraduatedPayload>(
    (data) => {
      if (normalizeTokenAddress(data.token) !== address) return;
      queryClient.invalidateQueries({ queryKey: ["token", address] });
      queryClient.invalidateQueries({ queryKey: ["trades", address] });
      queryClient.setQueryData(["token", address], (old: TokenDetail | undefined) =>
        old
          ? ({
              ...old,
              graduated: true,
              pair: data.pair,
            } as TokenDetail)
          : old
      );
    },
    { eventName: "token:graduated" },
    [address, queryClient]
  );

  useEffect(() => {
    const cards = document.querySelectorAll<HTMLElement>(".bg-flashlight");
    cards.forEach((el) => {
      el.onmousemove = (e: MouseEvent) => {
        const x = e.pageX - el.offsetLeft;
        const y = e.pageY - el.offsetTop;
        el.style.setProperty("--x", `${x}px`);
        el.style.setProperty("--y", `${y}px`);
      };
    });
  }, []);

  return (
    <div className="lclp-section-gap">
      <div className="container mx-auto space-y-10 px-4">
        <Card className="overflow-hidden border-border/60">
          <div className="flex flex-col lg:flex-row">
            <div className="relative h-64 w-full shrink-0 p-6 lg:h-auto lg:w-80">
              <img
                src={bannerUrl || "/images/card/card-img-1.png"}
                alt={token.name}
                className="h-full w-full rounded-lg object-contain"
              />
            </div>
            <CardContent className="relative flex-1 space-y-4 p-6">
              <p className="text-sm text-muted-foreground">
                Created by <span className="text-primary">{token.creator.slice(0, 10)}…</span>
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <h1 className="text-2xl font-bold md:text-3xl">
                  {token.name} ($ {token.symbol})
                </h1>
                <img
                  src={imageUrl || "/images/card/card-img-sm-1.png"}
                  className="h-12 w-12 rounded-lg object-cover"
                  alt={token.symbol}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                <span className="text-muted-foreground">Contract:</span>
                <span className="break-all">{token.address}</span>
                <button type="button" onClick={handleCopy} aria-label="Copy address">
                  {isCopied ? (
                    <Check size={16} className="text-green-500" />
                  ) : (
                    <Copy size={16} className="text-muted-foreground hover:text-foreground" />
                  )}
                </button>
              </div>
              <p className="text-sm text-muted-foreground">{token.metadata.description}</p>
              <div className="flex gap-3">
                {token.metadata.website && (
                  <Link href={token.metadata.website} target="_blank" className="text-primary">
                    <Globe size={18} />
                  </Link>
                )}
                {token.metadata.telegram && (
                  <Link href={token.metadata.telegram} target="_blank" className="text-primary">
                    <Send size={18} />
                  </Link>
                )}
              </div>
            </CardContent>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Price" value={`$${formatNumber(priceUSD, { maximumFractionDigits: 8 })}`} />
          <StatCard label="Market Cap" value={`$${formatNumber(marketCapUSD)}`} />
          <StatCard label="Virtual Liquidity" value={`$${formatNumber(liquidityUSD)}`} />
          <StatCard label="24H Volume" value={`${formatNumber(volume24hNative)} ${chain.nativeCurrency.symbol}`} />
          <StatCard label="Token Created" value={dayjs(token.createdAt).fromNow()} />
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <TokenChart />
          </div>
          <div className="space-y-6">
            <TokenTradePanel />

            <div className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
              <h4 className="flex justify-between gap-2 font-medium">
                Bonding Curve Progress
                <span> {bondingCurvePercentage.toFixed(2)}%</span>
              </h4>
              <Progress value={bondingCurvePercentage} className="h-3" />
              {token.graduated ? (
                <p className="text-sm text-muted-foreground">Coin has graduated!</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  There are {formatNumber(remainingForSaleNative)} {token.symbol} still available for sale in the
                  bonding curve and{" "}
                  {fundingRaisedNative.toLocaleString(undefined, {
                    maximumFractionDigits: 6,
                  })}{" "}
                  / {fundingGoalNative.toLocaleString(undefined, { maximumFractionDigits: 6 })}{" "}
                  {chain.nativeCurrency.symbol} has been raised.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <TokenTradeTable trades={trades} />
          </div>
          <div className="lg:col-span-2">
            <TokenHolderTable />
          </div>
        </div>
      </div>
    </div>
  );
}
