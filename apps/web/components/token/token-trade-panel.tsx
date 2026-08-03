"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useSuspenseQuery } from "@tanstack/react-query";
import Image from "next/image";

import { TokenBuyForm } from "@/components/token/token-buy-form";
import { TokenSellForm } from "@/components/token/token-sell-form";
import tokenQuery from "@/queries/tokenQuery";
import { Card, CardContent } from "@lcai/ui/components/card";
import { cn } from "@lcai/ui/lib/utils";

export function TokenTradePanel() {
  const { address } = useParams<{ address: string }>();
  const { data: token } = useSuspenseQuery(tokenQuery(address));
  const [tab, setTab] = useState<"buy" | "sell">("buy");

  return (
    <Card className="relative overflow-hidden border-border/60 p-0">
      <div className="pointer-events-none absolute -top-20 -right-20 opacity-30">
        <Image src="/images/details/form-shape.png" width={280} height={280} alt="" unoptimized />
      </div>
      <CardContent className="relative z-10 px-4 py-4">
        <div className="flex rounded-full border border-border p-1">
          {(["buy", "sell"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={cn(
                "flex-1 rounded-full py-2 text-sm font-semibold uppercase transition",
                tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              )}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "buy" ? <TokenBuyForm /> : <TokenSellForm />}

        {token.graduated && <p className="theme-gradient mt-4 text-center text-xs">Trading via LightDEX</p>}
      </CardContent>
    </Card>
  );
}
