"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useSuspenseQuery } from "@tanstack/react-query";

import tokenQuery from "@/queries/tokenQuery";
import { Card } from "@lcai/ui/components/card";
import { Skeleton } from "@lcai/ui/components/skeleton";

const TVChartContainer = dynamic(() => import("@/components/TVChartContainer").then((mod) => mod.TVChartContainer), {
  ssr: false,
  loading: () => <Skeleton className="h-125 w-full rounded-xl" />,
});

export function TokenChart() {
  const { address } = useParams<{ address: string }>();
  const { data: token } = useSuspenseQuery(tokenQuery(address));

  return (
    <Card className="overflow-hidden border-border/60 p-2">
      <div className="h-125 w-full">
        {address ? (
          <TVChartContainer symbol={token.symbol} address={address} />
        ) : (
          <Skeleton className="h-full w-full" />
        )}
      </div>
    </Card>
  );
}
