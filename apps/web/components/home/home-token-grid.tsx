"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

import { TokenSearch } from "@/components/home/token-search";
import { TokenCard } from "@/components/home/token-card";
import { ListPagination } from "@/components/home/list-pagination";
import { $http } from "@/lib/http";
import type { Paginated, TokenListItem } from "@/types";

export function HomeTokenGrid() {
  const searchParams = useSearchParams();
  const queryString = useMemo(() => searchParams.toString(), [searchParams]);

  const { data: tokens, isFetching } = useQuery({
    queryKey: ["tokens", queryString],
    queryFn: () => $http.$get<Paginated<TokenListItem>>(`/tokens?${queryString}`),
  });

  return (
    <section className="lclp-section-gap">
      <div className="container mx-auto px-4">
        <div className="mb-8">
          <span className="section-eyebrow">All coins</span>
          <h2 className="mt-3 font-display text-3xl font-bold text-foreground md:text-4xl">
            Explore the Market
          </h2>
        </div>

        <TokenSearch />

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {isFetching ? (
            <div className="col-span-full flex justify-center py-16">
              <Loader2 className="size-12 animate-spin text-primary" />
            </div>
          ) : tokens?.data?.length ? (
            tokens.data.map((item) => <TokenCard key={item.address} item={item} />)
          ) : (
            <p className="col-span-full py-16 text-center text-muted-foreground">
              No tokens found matching your search criteria
            </p>
          )}
        </div>

        {tokens && <ListPagination meta={tokens.meta} />}
      </div>
    </section>
  );
}
