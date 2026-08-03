"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createAppKit } from "@reown/appkit/react";
import { type ReactNode } from "react";
import { WagmiProvider } from "wagmi";

import config from "@/config";
import { projectId, wagmiAdapter } from "@/config/wagmi";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@lcai/ui/components/tooltip";
import { Toaster } from "@lcai/ui/components/sonner";

import { getQueryClient } from "./get-query-client";

const metadata = {
  name: "LCAI Launchpad",
  description: "Launch and trade memecoins on Lightchain AI",
  url: typeof window !== "undefined" ? window.location.origin : "https://lightchain.ai",
  icons: ["https://assets.reown.com/reown-profile-pic.png"],
};

createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks: config.chains,
  defaultNetwork: config.chains[0],
  metadata,
  features: { analytics: true },
});

export default function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        <WagmiProvider config={wagmiAdapter.wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            {children}
            <ReactQueryDevtools />
          </QueryClientProvider>
        </WagmiProvider>
        <Toaster theme="dark" position="top-right" richColors closeButton />
      </TooltipProvider>
    </ThemeProvider>
  );
}
