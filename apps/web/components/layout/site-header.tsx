"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Rocket, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppKit } from "@reown/appkit/react";
import { useConnection } from "wagmi";

import menuData from "@/data/header.json";
import { ThemeToggle } from "@/components/theme-provider";
import { BrandButton } from "@/components/ui/brand-button";
import { cn } from "@lcai/ui/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@lcai/ui/components/sheet";
import WalletConnectButton from "../ui/wallet-connect-button";

export function SiteHeader() {
  const pathname = usePathname();
  const [sticky, setSticky] = useState(false);
  const [open, setOpen] = useState(false);
  const { open: openWallet } = useAppKit();
  const { isConnected } = useConnection();

  useEffect(() => {
    const onScroll = () => setSticky(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href.startsWith("#")) return false;
    return pathname.startsWith(href);
  };

  const navLinks = menuData.nav.filter((item) => !item.link.startsWith("#"));

  return (
    <header className="sticky top-0 z-50 px-3 pt-3 md:px-4 md:pt-4">
      <div
        className={cn(
          "container mx-auto flex h-16 items-center justify-between gap-4 rounded-full px-3 pl-5 glass transition-all duration-300 md:h-[68px]",
          sticky && "shadow-[0_18px_50px_-30px_rgba(0,0,0,0.9)]",
        )}
      >
        <Link href="/" className="shrink-0">
          {/* white wordmark for dark mode, black for light mode */}
          <Image
            src="/images/logo/logo.png"
            width={150}
            height={30}
            alt="LCAI Launchpad"
            priority
            className="hidden h-7 w-auto dark:block"
          />
          <Image
            src="/images/logo/logo-dark.svg"
            width={150}
            height={30}
            alt="LCAI Launchpad"
            priority
            className="block h-7 w-auto dark:hidden"
          />
        </Link>

        {/* Pill nav */}
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full border border-border/60 bg-background/30 p-1 backdrop-blur-md lg:flex">
          {navLinks.map((item) => {
            const active = isActive(item.link);
            return (
              <Link
                key={item.link}
                href={item.link}
                className={cn(
                  "relative rounded-full px-4 py-2 text-sm font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <span className="absolute inset-0 rounded-full bg-primary/15 ring-1 ring-primary/40" aria-hidden />
                )}
                <span className="relative">{item.text}</span>
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
          <WalletConnectButton />
        </div>

        {/* Mobile */}
        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <button type="button" aria-label="Open menu" className="rounded-full border border-border/60 bg-background/30 p-2.5 text-foreground backdrop-blur-md">
                {open ? <X size={20} /> : <Menu size={20} />}
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="glass border-border/60">
              <SheetHeader>
                <SheetTitle className="text-left font-display text-xl">Menu</SheetTitle>
              </SheetHeader>
              <nav className="mt-8 flex flex-col gap-1 px-2">
                {navLinks.map((item) => (
                  <Link
                    key={item.link}
                    href={item.link}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "rounded-xl px-4 py-3 text-base font-medium transition-colors",
                      isActive(item.link)
                        ? "bg-primary/15 text-foreground ring-1 ring-primary/30"
                        : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                    )}
                  >
                    {item.text}
                  </Link>
                ))}
                <Link
                  href="/create-token"
                  onClick={() => setOpen(false)}
                  className="btn-glow mt-4 w-full"
                >
                  <Rocket size={16} />
                  Launch Token
                </Link>
                <BrandButton
                  brandVariant="outline"
                  className="mt-2 w-full"
                  onClick={() => {
                    openWallet();
                    setOpen(false);
                  }}
                >
                  {isConnected ? "Wallet" : "Connect Wallet"}
                </BrandButton>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
