"use client";

import { cn } from "@/lib/utils";
import { useAppKit } from "@reown/appkit/react";
import { WalletIcon } from "lucide-react";
import { HTMLAttributes } from "react";
import { useConnection } from "wagmi";

export default function WalletConnectButton({
  className,
  ...props
}: HTMLAttributes<HTMLButtonElement>) {
  const { open } = useAppKit();
  const { address } = useConnection();

  return (
    <button
      type="button"
      className={cn("btn-default text-uppercase", className)}
      {...props}
      onClick={() => open()}
    >
      {/* inline-block + align-middle: btn-default is an inline-block with a 42px
          line-height, and Tailwind's preflight makes bare svgs display:block. */}
      <WalletIcon className="inline-block size-4 align-middle" />
      <span className="pl-3 hidden xl:inline-block">
        {address
          ? address.slice(0, 6) + "..." + address.slice(-4)
          : "Connect Wallet"}
      </span>
    </button>
  );
}
