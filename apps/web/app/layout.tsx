import type { Metadata } from "next";
import { DM_Sans, Bricolage_Grotesque } from "next/font/google";

import { BackToTop } from "@/components/layout/back-to-top";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import Providers from "./providers";

import "./globals.css";

// SCSS Styles
import "../public/scss/style.scss";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

// Distinctive display face for headlines and big numbers — characterful without
// drifting from the Lightchain brand's clean-grotesque body type.
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "LCAI Memecoin Launchpad",
  description: "Discover, launch, and trade memecoins on Lightchain AI.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${dmSans.variable} ${bricolage.variable} font-sans antialiased lcai-grain`}>
        <Providers>
          {/* fixed atmospheric field behind the entire app */}
          <div className="lcai-atmosphere" aria-hidden />
          <div className="relative flex min-h-screen flex-col">
            <div className="lclp-gradient-orb animate-float-slow -left-40 top-24 h-72 w-72" aria-hidden />
            <div className="lclp-gradient-orb animate-float-slow right-0 top-1/3 h-80 w-80 [animation-delay:-6s]" aria-hidden />
            <SiteHeader />
            <main className="relative z-10 flex-1">{children}</main>
            <SiteFooter />
            <BackToTop />
          </div>
        </Providers>
      </body>
    </html>
  );
}
