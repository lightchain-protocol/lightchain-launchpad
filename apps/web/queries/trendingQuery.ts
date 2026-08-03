import { queryOptions } from "@tanstack/react-query";

import { $http } from "@/lib/http";
import type { TrendingToken } from "@/types";

const TRENDING_LIMIT = 12;

export default function trendingQuery() {
  return queryOptions({
    queryKey: ["tokens", "trending", TRENDING_LIMIT],
    queryFn: () =>
      $http.$get<{ data: TrendingToken[] }>(
        `/tokens/trending?limit=${TRENDING_LIMIT}`,
      ),
    select: (res) => res.data,
    refetchInterval: 60_000,
  });
}
