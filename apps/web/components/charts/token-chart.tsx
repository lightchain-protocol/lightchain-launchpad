"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useSuspenseQuery } from "@tanstack/react-query";
import Script from "next/script";
import { useState } from "react";

import tokenQuery from "@/queries/tokenQuery";
import { Card } from "@lcai/ui/components/card";
import { Skeleton } from "@lcai/ui/components/skeleton";

const TVChartContainer = dynamic(() => import("@/components/TVChartContainer").then((mod) => mod.TVChartContainer), {
  ssr: false,
  loading: () => <Skeleton className="h-125 w-full rounded-xl" />,
});

export function TokenChart() {
  const [isScriptReady, setIsScriptReady] = useState(false);
  const { address } = useParams<{ address: string }>();
  const { data: token } = useSuspenseQuery(tokenQuery(address));

  return (
    <Card className="overflow-hidden border-border/60 p-2">
      <Script
        src="/trading-view/datafeeds/udf/dist/bundle.js"
        strategy="lazyOnload"
        onReady={() => setIsScriptReady(true)}
      />
      <div className="h-125 w-full">
        {isScriptReady && address ? (
          <TVChartContainer symbol={token.symbol} address={address} />
        ) : (
          <Skeleton className="h-full w-full" />
        )}
      </div>
    </Card>
  );
}
