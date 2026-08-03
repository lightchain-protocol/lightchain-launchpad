import { queryOptions } from "@tanstack/react-query";

import { $http } from "@/lib/http";
import { normalizeTokenAddress } from "@/lib/utils";
import type { TokenDetail } from "@/types";

export default function tokenQuery(address: string) {
  const normalized = normalizeTokenAddress(address);
  return queryOptions({
    queryKey: ["token", normalized],
    queryFn: () => $http.$get<TokenDetail>(`/tokens/${normalized}`),
  });
}
