"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useSuspenseQuery } from "@tanstack/react-query";

import dayjs from "@/lib/dayjs";
import useCurrentChain from "@/hooks/useCurrentChain";
import tokenQuery from "@/queries/tokenQuery";
import useNativePrice from "@/hooks/useNativePrice";
import { formatBigNumber, formatPrice, formatUsdPrice } from "@/lib/utils";
import type { Trade } from "@/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@lcai/ui/components/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@lcai/ui/components/tooltip";
import { ExternalLinkIcon } from "lucide-react";

export function TokenTradeTable({ trades }: { trades?: Trade[] }) {
  const chain = useCurrentChain();
  const { address } = useParams<{ address: string }>();
  const { data: token } = useSuspenseQuery(tokenQuery(address));
  const explorer = chain.blockExplorers?.default.url;
  const nativePrice = useNativePrice();
  const nativeSymbol = chain.nativeCurrency.symbol;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Account</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>{nativeSymbol}</TableHead>
          <TableHead>{token.symbol}</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Transaction</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {!trades?.length ? (
          <TableRow>
            <TableCell colSpan={7} className="py-10 text-center font-normal">
              No trades yet
            </TableCell>
          </TableRow>
        ) : (
          trades.map((trade) => (
            <TableRow key={trade.id}>
              <TableCell className="text-primary">
                {explorer ? (
                  <Link
                    href={`${explorer}/address/${trade.trader}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {trade.trader.slice(0, 6)}...{trade.trader.slice(-4)}
                  </Link>
                ) : (
                  <>
                    {trade.trader.slice(0, 6)}...{trade.trader.slice(-4)}
                  </>
                )}
              </TableCell>
              <TableCell className={trade.isBuy ? "text-success" : "text-destructive"}>
                {trade.isBuy ? "Buy" : "Sell"}
                {trade.source === "dex" && (
                  <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
                    DEX
                  </span>
                )}
              </TableCell>
              <TableCell>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-default">{formatBigNumber(trade.ethAmount, { notation: "compact" })}</span>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={4}>
                    {formatBigNumber(trade.ethAmount, { maximumFractionDigits: 8 })}
                  </TooltipContent>
                </Tooltip>
              </TableCell>
              <TableCell className={trade.isBuy ? "text-success" : "text-destructive"}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-default">
                      {formatBigNumber(trade.tokenAmount, { notation: "compact" })}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={4}>
                    {formatBigNumber(trade.tokenAmount, { maximumFractionDigits: 8 })}
                  </TooltipContent>
                </Tooltip>
              </TableCell>
              <TableCell>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-default">{dayjs(trade.timestamp).fromNow()}</span>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={4}>{dayjs(trade.timestamp).format("DD/MM/YYYY HH:mm:ss")}</TooltipContent>
                </Tooltip>
              </TableCell>
              <TableCell className="text-primary">
                {explorer ? (
                  <Link
                    href={`${explorer}/tx/${trade.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {trade.txHash.slice(0, 6)}...
                  </Link>
                ) : (
                  <>{trade.txHash.slice(0, 6)}...</>
                )}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
