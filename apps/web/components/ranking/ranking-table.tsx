"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import rankingQuery from "@/queries/rankingQuery";
import dayjs from "@/lib/dayjs";
import { ipfsToHttp, weiToNative } from "@/lib/ipfs";
import { formatUsd } from "@/lib/utils";
import useNativePrice from "@/hooks/useNativePrice";
import type { TokenListItem } from "@/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@lcai/ui/components/table";

function RankingRow({ item, rank, marketCapUSD }: { item: TokenListItem; rank: number; marketCapUSD: string }) {
  // const bondingPct = Math.min(100, item.progressBps / 100);
  const imageUrl = ipfsToHttp(item.metadata.imageUrl);

  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-0 items-center gap-4">
          <span className="theme-gradient shrink-0 text-xl font-bold">{rank}</span>
          <img
            src={imageUrl || "/images/card/card-img-sm-1.png"}
            className="h-12 w-12 shrink-0 rounded-lg bg-primary/30 object-contain"
            alt={item.name}
          />
          <Link href={`/token/${item.address}`} className="min-w-0 truncate font-medium hover:underline">
            {item.name} (${item.symbol})
          </Link>
        </div>
      </TableCell>
      <TableCell className="text-right font-medium">{marketCapUSD}</TableCell>
    </TableRow>
  );
}

export function RankingTable() {
  const nativePrice = useNativePrice();
  const { data: tokens, isLoading, isError, dataUpdatedAt } = useQuery(rankingQuery());

  const lastUpdated = useMemo(
    () => (dataUpdatedAt ? dayjs(dataUpdatedAt).format("YYYY/MM/DD [at] HH:mm") : null),
    [dataUpdatedAt]
  );

  return (
    <section className="lclp-section-gap">
      <div className="container mx-auto px-4">
        <div className="text-center">
          <h1 className="theme-gradient text-4xl font-bold">Lightchain Ranking</h1>
          <p className="mt-2 text-muted-foreground">
            {lastUpdated ? `Information refreshed on ${lastUpdated}` : "Market cap ranking by on-chain data"}
          </p>
        </div>

        <div className="mt-12 overflow-hidden rounded-xl">
          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="size-10 animate-spin text-primary" />
            </div>
          ) : isError ? (
            <p className="py-16 text-center text-muted-foreground">Failed to load ranking.</p>
          ) : (
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[70%] sm:w-3/4">Token</TableHead>
                  <TableHead className="w-[30%] text-right sm:w-1/4">Market Cap</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens?.map((item, index) => (
                  <RankingRow
                    key={item.address}
                    item={item}
                    rank={index + 1}
                    marketCapUSD={formatUsd(weiToNative(item.marketCap), nativePrice)}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </section>
  );
}
