import { Metadata } from "next";
import { notFound } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { TokenDetails } from "@/components/token/token-details";
import { getQueryClient } from "@/app/get-query-client";
import { normalizeTokenAddress } from "@/lib/utils";
import type { TokenDetail } from "@/types";

type PageProps = {
  params: Promise<{ address: string }>;
};

async function fetchToken(address: string): Promise<TokenDetail | undefined> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/tokens/${address}`,
    { cache: "no-store" },
  );
  if (!response.ok) return undefined;
  return response.json();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { address } = await params;
  const token = await fetchToken(address);
  if (!token) return {};
  return { title: `Buy ${token.name} tokens now (Sale is Live)` };
}

export default async function TokenPage({ params }: PageProps) {
  const { address: rawAddress } = await params;
  const address = normalizeTokenAddress(rawAddress);
  const queryClient = getQueryClient();

  const token = await queryClient.fetchQuery({
    queryKey: ["token", address],
    queryFn: () => fetchToken(address),
  });

  if (!token) notFound();

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TokenDetails />
    </HydrationBoundary>
  );
}
