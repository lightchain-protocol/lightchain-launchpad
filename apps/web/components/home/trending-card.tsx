import Link from "next/link";
import { useMemo } from "react";
import { Flame } from "lucide-react";

import { ipfsToHttp, weiToNative } from "@/lib/ipfs";
import { formatUsd } from "@/lib/utils";
import useNativePrice from "@/hooks/useNativePrice";
import type { TokenListItem } from "@/types";

export function TrendingCard({ item, rank }: { item: TokenListItem; rank?: number }) {
  const nativePrice = useNativePrice();
  const bondingPct = Math.min(100, item.progressBps / 100);
  const marketCapUSD = formatUsd(weiToNative(item.marketCap), nativePrice, { notation: "compact" });
  const imageUrl = ipfsToHttp(item.metadata.imageUrl);
  const bannerUrl = ipfsToHttp(item.metadata.bannerUrl) ?? imageUrl;

  const description = useMemo(() => {
    const d = item.metadata.description ?? "";
    return d.length > 90 ? `${d.slice(0, 90)}…` : d || "No description provided.";
  }, [item.metadata.description]);

  return (
    <Link href={`/token/${item.address}`} className="group block">
      <article className="glass-card overflow-hidden rounded-2xl">
        <div className="relative aspect-[372/170] w-full overflow-hidden">
          <img
            src={bannerUrl || "/images/card/card-img-1.png"}
            alt={item.name}
            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-card to-transparent" />
          <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-bold text-[#ff8f3c] ring-1 ring-[#ff8f3c]/30 backdrop-blur-md">
            <Flame size={12} />
            {rank ? `#${rank} Trending` : "Trending"}
          </span>
        </div>

        <div className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <img
              src={imageUrl || "/images/card/card-img-sm-1.png"}
              className="h-11 w-11 shrink-0 rounded-xl object-cover ring-1 ring-white/10"
              alt={item.name}
            />
            <div className="min-w-0 flex-1">
              <h3 className="flex items-baseline gap-1.5 truncate font-display font-bold text-foreground transition-colors group-hover:text-primary">
                {item.name}
                <span className="text-xs font-medium text-muted-foreground">${item.symbol}</span>
              </h3>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{description}</p>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Market Cap</span>
            <span className="font-display font-bold text-foreground">{marketCapUSD}</span>
          </div>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(bondingPct, 2)}%`,
                background: "linear-gradient(90deg, #12b5de, #7130c3 55%, #ff3bd4)",
              }}
            />
          </div>
        </div>
      </article>
    </Link>
  );
}
