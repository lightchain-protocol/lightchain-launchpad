import Link from "next/link";
import { Rocket, TrendingUp } from "lucide-react";

import { HeroStats } from "@/components/home/hero-ticker";

export function HomeHero() {
  return (
    <section className="relative overflow-hidden">
      {/* spotlight behind the headline */}
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[260px] w-[700px] -translate-x-1/2 rounded-full opacity-50 blur-[110px]"
        style={{ background: "radial-gradient(circle, rgba(112,100,233,0.45), transparent 70%)" }}
        aria-hidden
      />

      <div className="container relative mx-auto px-4 pb-8 pt-10 text-center lg:pt-14">
        <div className="animate-rise [animation-delay:40ms]">
          <span className="section-eyebrow">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            Live on Lightchain AI
          </span>
        </div>

        <h1 className="animate-rise mx-auto mt-5 max-w-4xl font-display text-4xl font-bold leading-[1.05] tracking-tight text-foreground [animation-delay:120ms] md:text-5xl lg:text-6xl">
          Launch &amp; trade <span className="text-gradient-flow">Memecoins</span> at light speed
        </h1>

        <p className="animate-rise mx-auto mt-4 max-w-xl text-sm text-muted-foreground [animation-delay:200ms] md:text-base">
          Fair-launch bonding curves, live charts, and instant on-chain trading. Every coin graduates
          to LightDEX once it fills.
        </p>

        <div className="animate-rise mt-7 flex flex-wrap items-center justify-center gap-3 [animation-delay:280ms]">
          <Link href="/create-token" className="btn-glow">
            <Rocket size={17} />
            Create a Token
          </Link>
          <Link href="/ranking" className="btn-glass">
            <TrendingUp size={17} />
            View Ranking
          </Link>
        </div>

        <div className="animate-rise mt-9 [animation-delay:360ms]">
          <HeroStats />
        </div>
      </div>
    </section>
  );
}
