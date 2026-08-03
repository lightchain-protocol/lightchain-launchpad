# LCAI Launchpad Frontend (`@lcai/frontend`)

Next.js 16 + Tailwind v4 + shadcn (`@lcai/ui`). This is the active launchpad UI.

## Setup

```sh
cp .env.example .env
# Set NEXT_PUBLIC_API_URL (include /v1) and NEXT_PUBLIC_WEBSCOKET_URL

pnpm install
pnpm dev:frontend   # from repo root — builds @lcai/abis first
```

## Routes

- `/` — home, trending, token grid
- `/create-token` — metadata upload + on-chain launch
- `/ranking` — market cap leaderboard
- `/token/[address]` — chart, trade, trades/holders

Legacy Bootstrap UI: [`../old-web`](../old-web).
