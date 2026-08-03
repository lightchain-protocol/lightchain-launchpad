import Image from "next/image";
import Link from "next/link";
import { Rocket } from "lucide-react";

const linkGroups = [
  {
    title: "Useful links",
    links: [
      { label: "Documentation", href: "https://docs.lightchain.ai" },
      { label: "Whitepaper", href: "https://lightchain.ai/lightchain-whitepaper.pdf", external: true },
      { label: "Announcements", href: "https://news.lightchain.ai" },
    ],
  },
  {
    title: "Presale",
    links: [
      { label: "How to Buy", href: "https://lightchain.ai/how-to-buy" },
      { label: "Support", href: "https://t.me/LightchainAI" },
      { label: "Win $100k", href: "https://lightchain.ai/join" },
    ],
  },
  {
    title: "Socials",
    links: [
      { label: "Twitter (X)", href: "https://x.com/LightchainAI" },
      { label: "Telegram", href: "https://t.me/LightchainProtocol" },
      { label: "Linktree", href: "https://linktr.ee/lightchainai" },
    ],
  },
  {
    title: "Blockchain",
    links: [
      { label: "Explorer (Testnet)", href: "https://testnet.lightscan.app", external: true },
      { label: "Faucet", href: "https://lightfaucet.ai", external: true },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto">
      <div className="container mx-auto px-4">
        {/* Gradient CTA band */}
        <div className="relative overflow-hidden rounded-3xl border border-primary/20 px-6 py-12 text-center md:px-16 md:py-16">
          <div
            className="pointer-events-none absolute inset-0 opacity-90"
            style={{
              background:
                "radial-gradient(60% 120% at 50% 0%, rgba(112,100,233,0.28), transparent 70%), linear-gradient(120deg, rgba(18,181,222,0.12), rgba(255,59,212,0.12))",
            }}
            aria-hidden
          />
          <div className="relative">
            <h2 className="mx-auto max-w-2xl font-display text-3xl font-bold text-foreground md:text-5xl">
              Got a coin idea? <span className="theme-gradient">Launch it now.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Deploy a fair-launch token on Lightchain AI in under a minute. No code required.
            </p>
            <Link href="/create-token" className="btn-glow mx-auto mt-8 w-fit">
              <Rocket size={17} />
              Create a Token
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-16 border-t border-border/60 bg-background/40 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-14">
          <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
            <div className="max-w-xs">
              <Link href="/">
                <Image
                  src="/images/logo/logo.png"
                  width={160}
                  height={32}
                  alt="LCAI"
                  className="hidden h-8 w-auto dark:block"
                />
                <Image
                  src="/images/logo/logo-dark.svg"
                  width={160}
                  height={32}
                  alt="LCAI"
                  className="block h-8 w-auto dark:hidden"
                />
              </Link>
              <p className="mt-4 text-sm text-muted-foreground">
                Empowering a new era by revolutionizing decentralized AI with blockchain synergy.
              </p>
            </div>

            {linkGroups.map((group) => (
              <div key={group.title}>
                <h4 className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-foreground">
                  {group.title}
                </h4>
                <ul className="space-y-2.5">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        target={link.external ? "_blank" : undefined}
                        rel={link.external ? "noopener noreferrer" : undefined}
                        className="text-sm text-muted-foreground transition-colors hover:text-primary"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-border/40 pt-6 text-center sm:flex-row sm:text-left">
            <p className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} Lightchain AI. All rights reserved.
            </p>
            <p className="text-xs text-muted-foreground">Built on the Lightchain AI EVM network.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
