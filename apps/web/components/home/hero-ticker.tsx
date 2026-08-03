"use client";

import { useQuery } from "@tanstack/react-query";

import trendingQuery from "@/queries/trendingQuery";
import { weiToNative } from "@/lib/ipfs";
import { formatNumber } from "@/lib/utils";
import useStore from "@/store";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center px-5 sm:px-8">
      <span className="font-display text-xl font-bold text-foreground sm:text-2xl">{value}</span>
      <span className="mt-0.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
    </div>
  );
}

/** Compact live stat strip for the hero (no marquee — kept tight, pump.fun-style). */
export function HeroStats() {
  const { nativePrice } = useStore();
  const { data: tokens } = useQuery(trendingQuery());

  const list = tokens ?? [];
  const graduated = list.filter((t) => t.graduated).length;
  const volume24h = list.reduce((sum, t) => sum + weiToNative(t.volume24h) * nativePrice, 0);

  return (
    <div className="mx-auto inline-flex items-center divide-x divide-border/50 rounded-full glass px-2 py-3">
      <Stat label="Trending" value={list.length ? String(list.length) : "—"} />
      <Stat
        label="24h Volume"
        value={volume24h ? `$${formatNumber(volume24h, { notation: "compact" })}` : "—"}
      />
      <Stat label="Graduated" value={list.length ? String(graduated) : "—"} />
    </div>
  );
}
