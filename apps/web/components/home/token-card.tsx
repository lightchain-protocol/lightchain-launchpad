import Link from "next/link";
import { useMemo } from "react";
import { CheckCircle2 } from "lucide-react";

import dayjs from "@/lib/dayjs";
import { ipfsToHttp, weiToNative } from "@/lib/ipfs";
import { formatNumber } from "@/lib/utils";
import useStore from "@/store";
import type { TokenListItem } from "@/types";

export function TokenCard({ item }: { item: TokenListItem }) {
  const { nativePrice } = useStore();
  const bondingPct = useMemo(() => Math.min(100, item.progressBps / 100), [item.progressBps]);
  const marketCapUSD = weiToNative(item.marketCap) * nativePrice;
  const imageUrl = ipfsToHttp(item.metadata.imageUrl);
  const bannerUrl = ipfsToHttp(item.metadata.bannerUrl) ?? imageUrl;
  const tag = item.metadata.tags?.[0];

  return (
    <Link href={`/token/${item.address}`} className="group block">
      <article className="glass-card h-full overflow-hidden rounded-2xl">
        {/* Banner */}
        <div className="relative aspect-[372/200] w-full overflow-hidden">
          <img
            src={bannerUrl || "/images/card/card-img-1.png"}
            alt={item.name}
            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/20 to-transparent" />
          {tag && (
            <span className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/40 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white backdrop-blur-md">
              {tag}
            </span>
          )}
          {item.graduated && (
            <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-success/20 px-2.5 py-1 text-[11px] font-semibold text-success ring-1 ring-success/40 backdrop-blur-md">
              <CheckCircle2 size={12} /> Listed
            </span>
          )}
        </div>

        <div className="relative p-4 pt-9">
          {/* avatar overlapping banner */}
          <img
            src={imageUrl || "/images/card/card-img-sm-1.png"}
            className="absolute -top-7 left-4 h-14 w-14 rounded-xl object-cover ring-2 ring-card shadow-lg"
            alt={item.name}
          />

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              by <span className="text-primary">{item.creator.slice(0, 6)}…{item.creator.slice(-4)}</span>
            </span>
            <span>{dayjs(item.createdAt).fromNow()}</span>
          </div>

          <h3 className="mt-1.5 flex items-baseline gap-1.5 truncate font-display text-lg font-bold text-foreground transition-colors group-hover:text-primary">
            {item.name}
            <span className="text-sm font-medium text-muted-foreground">${item.symbol}</span>
          </h3>

          <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
            {item.metadata.description || "No description provided."}
          </p>

          <div className="mt-4 flex items-end justify-between">
            <div>
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Market Cap</span>
              <p className="font-display text-lg font-bold text-foreground">${formatNumber(marketCapUSD, { notation: "compact" })}</p>
            </div>
            {!item.graduated && (
              <span className="text-sm font-semibold text-primary">{bondingPct.toFixed(0)}%</span>
            )}
          </div>

          {item.graduated ? (
            <div className="mt-3 rounded-lg bg-gradient-to-r from-[#12b5de]/15 via-[#7130c3]/15 to-[#ff3bd4]/15 px-3 py-2 text-center text-xs font-semibold theme-gradient">
              Graduated to LightDEX
            </div>
          ) : (
            <div className="mt-3">
              <div className="shimmer relative h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(bondingPct, 2)}%`,
                    background: "linear-gradient(90deg, #12b5de, #7130c3 55%, #ff3bd4)",
                  }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">Bonding curve progress</p>
            </div>
          )}
        </div>
      </article>
    </Link>
  );
}
