"use client";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@lcai/ui/components/dialog";
import { Button } from "@lcai/ui/components/button";
import { Input } from "@lcai/ui/components/input";
import { Label } from "@lcai/ui/components/label";
import { cn } from "@lcai/ui/lib/utils";

import useUserStore from "@/store/user-store";
import { SettingsIcon, XIcon } from "lucide-react";
import type { JSX } from "react";

const slippageToleranceOptions = [0.1, 0.5, 1];

type Props = {
  trigger?: JSX.Element;
  className?: string;
};

export function SettingDialog({ trigger, className }: Props) {
  const { slippageTolerance, txDeadline } = useUserStore();

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ? (
          trigger
        ) : (
          <Button
            className={cn(
              "bg-transparent text-primary hover:bg-[var(--clr-gray-200)] hover:text-[var(--clr-primary)] dark:hover:bg-[var(--clr-blackest)]",
              className
            )}
            size={"icon"}
          >
            <SettingsIcon size={20} />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="border-border bg-card sm:max-w-md" showCloseButton={false}>
        <DialogClose className="absolute -top-2 -right-2 flex h-8 w-8! items-center justify-center rounded-full border border-[var(--clr-border-light)] bg-[#EFEFFF] transition-all duration-300 hover:text-[var(--clr-primary)] dark:border-[#2B294D] dark:bg-[var(--clr-blackest)]">
          <XIcon size={16} />
        </DialogClose>
        <DialogHeader>
          <DialogTitle className="text-2xl tracking-[-1px]">Settings</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label>Slippage Tolerance</Label>
            <div className="grid grid-cols-4 gap-1 md:gap-2">
              {slippageToleranceOptions.map((option, key) => (
                <Button
                  key={key}
                  variant={"secondary"}
                  onClick={() => useUserStore.setState({ slippageTolerance: option })}
                >
                  {option}%
                </Button>
              ))}
              <div className="flex items-center gap-1">
                <Input
                  value={slippageTolerance}
                  type="number"
                  step={0.1}
                  onChange={(e) =>
                    useUserStore.setState({
                      slippageTolerance: Number(e.target.value),
                    })
                  }
                />
                %
              </div>
            </div>
            {slippageTolerance < 0.5 && <p className="mt-1 text-sm text-yellow-600">Your transaction may fail</p>}
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label className="shrink-0">Tx deadline (mins)</Label>
            <Input
              type="number"
              className=""
              min={2}
              value={txDeadline}
              onChange={(e) => useUserStore.setState({ txDeadline: Number(e.target.value) })}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
