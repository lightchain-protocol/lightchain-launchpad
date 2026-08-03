import { Suspense } from "react";

import { HomeTokenGrid } from "@/components/home/home-token-grid";
import { HomeHero } from "@/components/home/home-hero";
import { TrendingSection } from "@/components/home/trending-section";
import { Skeleton } from "@lcai/ui/components/skeleton";

export default function HomePage() {
  return (
    <div>
      <HomeHero />
      <TrendingSection />
      <Suspense
        fallback={
          <div className="container mx-auto grid gap-6 px-4 py-16 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-80 rounded-2xl" />
            ))}
          </div>
        }
      >
        <HomeTokenGrid />
      </Suspense>
    </div>
  );
}
