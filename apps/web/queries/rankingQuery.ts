import { queryOptions } from "@tanstack/react-query";

import { $http } from "@/lib/http";
import type { Paginated, TokenListItem } from "@/types";

const RANKING_LIMIT = 50;

export default function rankingQuery() {
  return queryOptions({
    queryKey: ["tokens", "ranking", RANKING_LIMIT],
    queryFn: () =>
      $http.$get<Paginated<TokenListItem>>(
        `/tokens?sort=marketCap&status=all&limit=${RANKING_LIMIT}&page=1`,
      ),
    select: (res) => res.data,
    refetchInterval: 60_000,
  });
}
