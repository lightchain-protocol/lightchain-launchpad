"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { $http } from "@/lib/http";
import useCurrentChain from "@/hooks/useCurrentChain";
import type { HoldersResponse } from "@/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@lcai/ui/components/table";

export function TokenHolderTable() {
  const chain = useCurrentChain();
  const { address } = useParams<{ address: string }>();
  const explorer = chain.blockExplorers?.default.url;

  const { data: response, isLoading } = useQuery({
    queryKey: ["holders", address],
    queryFn: () => $http.$get<HoldersResponse>(`/tokens/${address}/holders`),
  });

  const holders = response?.data;

  if (isLoading) {
    return (
      <div className="flex justify-center rounded-xl bg-card py-16">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Holder</TableHead>
          <TableHead className="text-right">Percentage</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {!holders?.length ? (
          <TableRow>
            <TableCell colSpan={2} className="py-10 text-center font-normal">
              No holders data
            </TableCell>
          </TableRow>
        ) : (
          holders.map((holder) => (
            <TableRow key={holder.address}>
              <TableCell className="text-primary">
                {explorer ? (
                  <Link
                    href={`${explorer}/address/${holder.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {holder.address.slice(0, 6)}...{holder.address.slice(-4)}
                  </Link>
                ) : (
                  <>
                    {holder.address.slice(0, 6)}...{holder.address.slice(-4)}
                  </>
                )}
              </TableCell>
              <TableCell className="text-right">
                {(holder.pct * 100).toLocaleString(undefined, {
                  maximumFractionDigits: 4,
                })}
                %
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
