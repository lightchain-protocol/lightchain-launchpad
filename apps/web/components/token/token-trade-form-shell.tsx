"use client";

import { ArrowLeftRight, Loader2, Wallet } from "lucide-react";
import type { SubmitEvent, ReactNode } from "react";

import { BrandButton } from "@/components/ui/brand-button";
import { formatNumber } from "@/lib/utils";
import { Input } from "@lcai/ui/components/input";
import { cn } from "@lcai/ui/lib/utils";
import { SettingDialog } from "./setting-dialog";

export type TokenTradeFormShellProps = {
  amount: string;
  onAmountChange: (value: string) => void;
  assetSymbol: string;
  assetIconSrc: string;
  balance: { isLoading: boolean; formatted?: string | number };
  balanceSymbol: string;
  insufficientAmount?: boolean;
  amountPresets?: number[];
  percentagePresets?: number[];
  onPercentagePreset?: (percentage: number) => void;
  onSwitchInput?: () => void;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  submitDisabled?: boolean;
  submitLabel: ReactNode;
  quoteLoading?: boolean;
  quoteText?: ReactNode;
};

export function TokenTradeFormShell({
  amount,
  onAmountChange,
  assetSymbol,
  assetIconSrc,
  balance,
  balanceSymbol,
  insufficientAmount = false,
  amountPresets,
  percentagePresets,
  onPercentagePreset,
  onSwitchInput,
  onSubmit,
  submitDisabled = false,
  submitLabel,
  quoteLoading = false,
  quoteText,
}: TokenTradeFormShellProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4 pt-4">
      <div className="space-y-2">
        <div className="flex justify-end">
          <SettingDialog />
        </div>
        <div className="rounded-xl border border-border bg-muted/20 px-5 pt-3 pb-2.5">
          <div className="relative">
            <Input
              type="number"
              inputMode="decimal"
              placeholder="Enter the amount"
              value={amount}
              min={0}
              step="any"
              onChange={(e) => onAmountChange(e.target.value)}
              className={cn(
                "border-0 bg-transparent! py-0 pl-0 text-lg shadow-none focus-visible:ring-0",
                onSwitchInput ? "pr-36" : "pr-24",
              )}
            />
            <div className="absolute top-1/2 right-0 flex -translate-y-1/2 items-center gap-2">
              <span className="max-w-24 truncate text-sm font-medium">{assetSymbol}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assetIconSrc} width={28} height={28} className="rounded-full object-cover" alt="" />
              {onSwitchInput && (
                <>
                  <div className="h-5 w-px bg-border" />
                  <button
                    type="button"
                    onClick={onSwitchInput}
                    aria-label="Switch input currency"
                    className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  >
                    <ArrowLeftRight size={16} />
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="mt-2.5 flex items-center justify-end gap-1 text-xs text-muted-foreground">
            <Wallet size={12} />
            {balance.isLoading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <span>
                {formatNumber(balance.formatted ?? 0)} {balanceSymbol}
              </span>
            )}
          </div>
        </div>
      </div>

      {insufficientAmount && <p className="text-sm text-destructive">Insufficient balance</p>}

      {percentagePresets && percentagePresets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {percentagePresets.map((preset) => (
            <button
              key={preset}
              type="button"
              className="flex-1 rounded-md border border-border bg-muted/40 py-2 text-sm hover:border-primary"
              onClick={() => onPercentagePreset?.(preset)}
            >
              {preset} %
            </button>
          ))}
        </div>
      )}

      {amountPresets && amountPresets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {amountPresets.map((preset) => (
            <button
              key={preset}
              type="button"
              className="flex-1 rounded-md border border-border bg-muted/40 py-2 text-sm hover:border-primary"
              onClick={() => onAmountChange(preset.toString())}
            >
              {preset} {assetSymbol}
            </button>
          ))}
        </div>
      )}

      <BrandButton type="submit" className="w-full" disabled={submitDisabled}>
        {submitLabel}
      </BrandButton>

      {quoteLoading ||
        (quoteText && (
          <p className={cn("text-center text-xs text-muted-foreground")}>
            {quoteLoading ? <Loader2 className="mx-auto size-4 animate-spin" /> : quoteText}
          </p>
        ))}
    </form>
  );
}
