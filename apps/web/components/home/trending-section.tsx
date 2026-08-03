"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Flame, Loader2 } from "lucide-react";

import trendingQuery from "@/queries/trendingQuery";
import { TrendingCard } from "@/components/home/trending-card";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@lcai/ui/components/carousel";

export function TrendingSection() {
  const { data: tokens, isLoading, isError } = useQuery(trendingQuery());

  if (!isLoading && !isError && !tokens?.length) return null;

  return (
    <section className="lclp-section-gap">
      <div className="container mx-auto px-4">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="section-eyebrow">
              <Flame size={13} /> Hot right now
            </span>
            <h2 className="mt-3 font-display text-3xl font-bold text-foreground md:text-4xl">
              Trending Tokens
            </h2>
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            The coins with the most momentum in the last 24 hours.
          </p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="size-10 animate-spin text-primary" />
          </div>
        ) : isError ? (
          <p className="text-center text-muted-foreground">Could not load trending tokens.</p>
        ) : (
          <Carousel opts={{ align: "start", loop: (tokens?.length ?? 0) >= 4 }} className="w-full">
            <CarouselContent className="-ml-4">
              {tokens?.map((item, i) => (
                <CarouselItem key={item.address} className="basis-full pl-4 sm:basis-1/2 lg:basis-1/3">
                  <TrendingCard item={item} rank={i + 1} />
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="left-0 glass border-border/60">
              <ChevronLeft />
            </CarouselPrevious>
            <CarouselNext className="right-0 glass border-border/60">
              <ChevronRight />
            </CarouselNext>
          </Carousel>
        )}
      </div>
    </section>
  );
}
