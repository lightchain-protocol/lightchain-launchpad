"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Check, Copy, Globe, Send } from "lucide-react";
import { formatEther } from "viem";

import { TokenChart } from "@/components/charts/token-chart";
import { CreatorFeesCard } from "@/components/token/creator-fees-card";
import { TokenHolderTable } from "@/components/token/token-holder-table";
import { TokenTradePanel } from "@/components/token/token-trade-panel";
import { TokenTradeTable } from "@/components/token/token-trade-table";
import { $http } from "@/lib/http";
import dayjs from "@/lib/dayjs";
import { ipfsToHttp, weiToNative } from "@/lib/ipfs";
import { formatNumber, formatPrice, formatUsd, formatUsdPrice, normalizeTokenAddress } from "@/lib/utils";
import tokenQuery from "@/queries/tokenQuery";
import useCurrentChain from "@/hooks/useCurrentChain";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useRealtimeRoom, useSocketIOEvent } from "@/hooks/useSocketIoEvent";
import useNativePrice from "@/hooks/useNativePrice";
import type {
  Paginated,
  Token,
  TokenDetail,
  TokenGraduatedPayload,
  TokenUpdatePayload,
  Trade,
  TradeEventPayload,
} from "@/types";
import { Card } from "@lcai/ui/components/card";
import { Progress } from "@lcai/ui/components/progress";
import { cn } from "@lcai/ui/lib/utils";

type MobileTab = "info" | "chart" | "trade";

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

function truncateAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function CopyableAddress({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
    >
      <span className="text-muted-foreground/80">{label}</span>
      <span>{truncateAddress(value)}</span>
      {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
    </button>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-border/50 px-4 py-3.5 odd:border-r sm:border-r sm:last:border-r-0">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-border/60 bg-muted/30 px-3 py-1.5">
      <span className="text-[10px] text-muted-foreground uppercase">{label} </span>
      <span className="text-xs font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function MobileTopTabs({ value, onChange }: { value: MobileTab; onChange: (tab: MobileTab) => void }) {
  const tabs: { id: MobileTab; label: string }[] = [
    { id: "info", label: "Info" },
    { id: "chart", label: "Chart" },
    { id: "trade", label: "$ Buy/Sell" },
  ];

  return (
    <div className="sticky top-[4.75rem] z-20 -mx-4 border-b border-border/60 bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/80 lg:hidden">
      <div className="flex">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative flex-1 py-3 text-center text-sm font-semibold transition",
              value === tab.id ? "text-primary" : "text-muted-foreground"
            )}
          >
            {tab.label}
            {value === tab.id && (
              <span className="absolute inset-x-4 -bottom-px h-0.5 rounded-full bg-primary shadow-[0_0_12px] shadow-primary/60" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function BondingCurveCard({
  percentage,
  graduated,
  remainingForSale,
  symbol,
  raised,
  goal,
  nativeSymbol,
}: {
  percentage: number;
  graduated: boolean;
  remainingForSale: number;
  symbol: string;
  raised: number;
  goal: number;
  nativeSymbol: string;
}) {
  return (
    <div className="bg-flashlight space-y-3 rounded-xl border border-border/60 bg-card p-4">
      <h4 className="flex items-baseline justify-between gap-2 text-sm font-medium">
        Bonding Curve Progress
        <span className="text-primary tabular-nums">{percentage.toFixed(2)}%</span>
      </h4>
      <Progress value={percentage} className="h-2.5" />
      {graduated ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          This coin has graduated. Trading continues on LightDEX.
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          There are {formatNumber(remainingForSale)} {symbol} still available for sale in the bonding curve and{" "}
          {raised.toLocaleString(undefined, { maximumFractionDigits: 6 })} /{" "}
          {goal.toLocaleString(undefined, { maximumFractionDigits: 6 })} {nativeSymbol} raised. At the funding goal,
          liquidity is seeded on LightDEX and LP is burned.
        </p>
      )}
    </div>
  );
}

export function TokenDetails() {
  const chain = useCurrentChain();
  const nativePrice = useNativePrice();
  const queryClient = useQueryClient();
  const [mobileTab, setMobileTab] = useState<MobileTab>("chart");
  // Avoid mounting TradingView in a `display:none` tree (or twice) — it won't paint.
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const { address: rawAddress } = useParams<{ address: string }>();
  const address = normalizeTokenAddress(rawAddress);
  const { data: token } = useSuspenseQuery(tokenQuery(address));

  useRealtimeRoom(`token:${address}`);

  const { data: trades } = useQuery({
    queryKey: ["trades", address],
    queryFn: () => $http.$get<Paginated<Trade>>(`/tokens/${address}/trades`).then((res) => res.data),
  });

  const priceUSD = formatUsdPrice(token.priceNative, nativePrice);
  const marketCapUSD = formatUsd(weiToNative(token.marketCap), nativePrice);
  const liquidityUSD = formatUsd(weiToNative(token.virtualEthReserve), nativePrice);
  const volume24hNative = weiToNative(token.volume24h);
  const fundingRaisedNative = weiToNative(token.realEthRaised);
  const fundingGoalNative = weiToNative(token.fundingGoal);
  const nativeSymbol = chain.nativeCurrency.symbol;

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

  const imageUrl = ipfsToHttp(token.metadata.imageUrl) || "/images/card/card-img-sm-1.png";

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

  const socialLinks = (
    <>
      {token.metadata.website && (
        <Link
          href={token.metadata.website}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label="Website"
        >
          <Globe size={14} />
        </Link>
      )}
      {token.metadata.telegram && (
        <Link
          href={token.metadata.telegram}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label="Telegram"
        >
          <Send size={14} />
        </Link>
      )}
    </>
  );

  const tokenHeader = (opts?: { compact?: boolean }) => (
    <div className={cn("flex w-full justify-between gap-4", opts?.compact ? "items-center" : "items-start")}>
      <div className="flex min-w-0 items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={token.name}
          className={cn(
            "shrink-0 rounded-xl bg-primary/30 object-contain ring-1 ring-border/60",
            opts?.compact ? "size-11" : "size-14"
          )}
        />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1
              className={cn("truncate font-bold tracking-tight", opts?.compact ? "text-base" : "text-xl md:text-2xl")}
            >
              {token.name}
              <span className="text-muted-foreground"> / {nativeSymbol}</span>
            </h1>
            {!opts?.compact && (
              <span className="rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground uppercase">
                {token.symbol}
              </span>
            )}
            {token.graduated && (
              <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                Graduated
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <CopyableAddress label="CA" value={token.address} />
            {!opts?.compact && <CopyableAddress label="DEV" value={token.creator} />}
            {socialLinks}
          </div>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className={cn("font-bold tracking-tight tabular-nums", opts?.compact ? "text-base" : "text-xl md:text-3xl")}>
          {formatPrice(token.priceNative, 6)}
          <span className="ml-1 text-sm font-semibold text-muted-foreground">{nativeSymbol}</span>
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">{priceUSD}</p>
      </div>
    </div>
  );

  const statsStripDesktop = (
    <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border/60 bg-card sm:grid-cols-4">
      <StatItem label="Market Cap" value={marketCapUSD} />
      <StatItem label="Virtual Liquidity" value={liquidityUSD} />
      <StatItem label="24H Volume" value={`${formatNumber(volume24hNative)} ${nativeSymbol}`} />
      <StatItem label="Created" value={dayjs(token.createdAt).fromNow()} />
    </div>
  );

  const statsPillsMobile = (
    <div className="flex flex-wrap gap-2">
      <StatPill label="MC" value={marketCapUSD} />
      <StatPill label="Liq" value={liquidityUSD} />
      <StatPill label="Vol" value={`${formatNumber(volume24hNative)} ${nativeSymbol}`} />
    </div>
  );

  const bondingCard = (
    <BondingCurveCard
      percentage={bondingCurvePercentage}
      graduated={token.graduated}
      remainingForSale={remainingForSaleNative}
      symbol={token.symbol}
      raised={fundingRaisedNative}
      goal={fundingGoalNative}
      nativeSymbol={nativeSymbol}
    />
  );

  const holdersCard = <TokenHolderTable />;

  const tradesCard = <TokenTradeTable trades={trades} />;

  let mobileBody: ReactNode;
  switch (mobileTab) {
    case "info":
      mobileBody = (
        <div className="space-y-4">
          {tokenHeader()}
          <div className="space-y-2 rounded-xl border border-border/60 bg-card p-4 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Created</span>
              <span>{dayjs(token.createdAt).fromNow()}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Creator</span>
              <CopyableAddress label="DEV" value={token.creator} />
            </div>
            {token.metadata.description && <p className="pt-2 text-muted-foreground">{token.metadata.description}</p>}
          </div>
          <CreatorFeesCard />
          {bondingCard}
          {holdersCard}
        </div>
      );
      break;
    case "trade":
      mobileBody = (
        <div className="space-y-4">
          {tokenHeader({ compact: true })}
          <TokenTradePanel />
        </div>
      );
      break;
    case "chart":
      mobileBody = (
        <div className="space-y-4">
          {tokenHeader({ compact: true })}
          {statsPillsMobile}
          <p className="text-xs text-muted-foreground">
            Created {dayjs(token.createdAt).fromNow()} ·{" "}
            <span className="font-mono">{truncateAddress(token.creator)}</span>
          </p>
          <TokenChart />
          {tradesCard}
        </div>
      );
      break;
    default: {
      const _exhaustive: never = mobileTab;
      void _exhaustive;
      mobileBody = null;
    }
  }

  return (
    <div className="lclp-section-gap-top pb-16">
      <div className="container mx-auto space-y-5 px-4">
        {isDesktop === false && (
          <>
            <MobileTopTabs value={mobileTab} onChange={setMobileTab} />
            {mobileBody}
          </>
        )}

        {isDesktop === true && (
          <div className="space-y-5">
            {tokenHeader()}

            {statsStripDesktop}

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
              <div className="min-w-0 space-y-5">
                <TokenChart />
                {tradesCard}
              </div>

              <aside className="space-y-4 lg:sticky lg:top-20">
                <TokenTradePanel />
                <CreatorFeesCard />
                {bondingCard}
                {holdersCard}
              </aside>
            </div>
          </div>
        )}

        {isDesktop === undefined && (
          <div className="space-y-5">
            {tokenHeader({ compact: true })}
            <div className="h-125 animate-pulse rounded-xl border border-border/60 bg-muted/20" />
          </div>
        )}
      </div>
    </div>
  );
}
