import Link from "next/link";
import { useMemo } from "react";
import { CheckCircle2 } from "lucide-react";

import dayjs from "@/lib/dayjs";
import { ipfsToHttp, weiToNative } from "@/lib/ipfs";
import { formatUsd } from "@/lib/utils";
import useNativePrice from "@/hooks/useNativePrice";
import type { TokenListItem } from "@/types";

export function TokenCard({ item }: { item: TokenListItem }) {
  const nativePrice = useNativePrice();
  const bondingPct = useMemo(() => Math.min(100, item.progressBps / 100), [item.progressBps]);
  const marketCapUSD = formatUsd(weiToNative(item.marketCap), nativePrice, { notation: "compact" });
  const imageUrl = ipfsToHttp(item.metadata.imageUrl);
  const tag = item.metadata.tags?.[0];
  const creatorShort = `${item.creator.slice(0, 6)}…${item.creator.slice(-4)}`;

  return (
    <Link href={`/token/${item.address}`} className="group block">
      <article className="glass-card flex h-full gap-3 overflow-hidden rounded-2xl p-3">
        {/* Left: square image */}
        <div className="relative size-28 shrink-0 overflow-hidden rounded-xl bg-primary/30 sm:size-40">
          <img
            src={imageUrl || "/images/card/card-img-sm-1.png"}
            alt={item.name}
            className="h-full w-full object-contain transition-transform duration-700 ease-out group-hover:scale-105"
          />
          {item.graduated && (
            <span className="absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-full bg-success/20 text-success ring-1 ring-success/40 backdrop-blur-md">
              <CheckCircle2 size={14} />
            </span>
          )}
        </div>

        {/* Right: data rows */}
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5 py-0.5">
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display truncate text-base font-bold text-foreground transition-colors group-hover:text-primary">
                {item.symbol} <span className="text-xs font-medium text-muted-foreground">{item.name}</span>
              </h3>
              {/* <span className="shrink-0 text-xs text-muted-foreground">{dayjs(item.createdAt).fromNow()}</span> */}
            </div>

            {tag && (
              <span className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                {tag}
              </span>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">created by:</span>
              <span className="truncate font-mono text-primary">{creatorShort}</span>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">Market Cap:</span>
              <span className="font-display font-semibold text-foreground">{marketCapUSD}</span>
            </div>
            {item.graduated ? (
              <div className="text-gradient-flow py-1.5 text-xs font-semibold">Graduated to LightDEX</div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="shimmer relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/6">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(bondingPct, 2)}%`,
                      background: "linear-gradient(90deg, #12b5de, #7130c3 55%, #ff3bd4)",
                    }}
                  />
                </div>
                <span className="shrink-0 text-xs font-semibold text-primary">{bondingPct.toFixed(1)}%</span>
              </div>
            )}
          </div>
        </div>
      </article>
    </Link>
  );
}
