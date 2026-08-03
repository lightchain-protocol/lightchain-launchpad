# LCAI Launchpad

A pump.fun-style meme-token launchpad on the LightchainAI (LCAI) EVM chain — bonding-curve
launches that graduate to a Uniswap V2 pool.

**Every token, trade, holder and graduation comes exclusively from indexed on-chain events.**
The only client→backend write in the system is the IPFS upload at `POST /v1/metadata`, which
returns a CID that the client then puts on-chain via `Launchpad.createToken(name, symbol, metadataURI)`.
There is no `POST /tokens` and no `POST /trades`.

## Layout

pnpm workspace + Turborepo (`apps/*` and `packages/*`; `contracts/` is standalone — see below).

```
├── apps/
│   ├── web/         @lcai/frontend  — Next.js 16 App Router, wagmi + Reown AppKit, TradingView
│   ├── api/         @lcai/api       — Fastify: REST /v1, socket.io, IPFS upload, metadata resolver
│   └── indexer/     @lcai/indexer   — Ponder: chain → Postgres, pg_notify for realtime
├── packages/
│   ├── abis/        @lcai/abis      — generated ABIs, single source of truth
│   ├── ui/          @lcai/ui        — shadcn/Radix + Tailwind v4 components
│   ├── eslint-config/ typescript-config/
└── contracts/       @lcai/contracts — Hardhat + Solidity (npm, not pnpm)
```

## Architecture

Two backend processes talk through Postgres only — no Redis, no message broker, no
inter-service HTTP. The indexer pushes realtime events with `pg_notify`; the API fans them
out to socket.io clients.

```
LCAI RPC ──► [Ponder indexer] ──INSERT + pg_notify──► [Postgres] ──drizzle reads──► [Fastify + socket.io]
                                                          ▲   LISTEN(lcai:*)             │
                                                          │                              │
                                              POST /v1/metadata                          ▼
                                              (Pinata pin + JSON)             REST on /v1, ws on /socket.io
                                                                                         │
                                                                                         ▼
                                                                                       web
```

- **Contracts** — `Launchpad.sol` is one monolithic UUPS proxy: factory, curve trading and
  graduation all live in it (no per-token curve clone). It deploys a `Token.sol` ERC20 per
  launch with the full supply minted to itself, sells along a constant-product virtual-reserve
  curve, and on hitting `fundingGoal` creates a Uniswap V2 pair, seeds it with the reserved LP
  supply + raised native, burns the LP, and emits `Graduated`.
- **Ponder indexer** (`apps/indexer/`) — watches the `Launchpad` plus two factory-derived
  contract sets: each freshly-deployed `Token` (ERC20 `Transfer` → holder balances) and each
  graduated `UniswapV2Pair` (`Swap` → post-graduation trades). Each handler runs its writes,
  then — for realtime events only, gated by a block-timestamp heuristic — issues a
  `SELECT pg_notify('lcai:<channel>', payload)` in the same transaction. Maintains OHLCV
  `candles` buckets (1m/5m/15m/1h/4h/1d) incrementally on each trade
  ([Ponder's time-series pattern](https://ponder.sh/docs/guides/time-series)). Reorg-aware,
  finality-lagged, resumable. Its built-in `/graphql` / `/sql` / `/ready` endpoints stay bound
  to localhost for debug.
- **Fastify API** (`apps/api/`) — REST + socket.io + `POST /v1/metadata` + in-process metadata
  resolver. Holds a single dedicated Postgres connection in `LISTEN` mode on the `lcai:*`
  channels and pushes each payload into socket.io rooms. Reads Ponder's tables with drizzle
  against the workspace-imported `@lcai/indexer/schema` — one schema definition, no mirrored
  copies.
- **One Postgres.** Ponder owns every table, including `token_metadata`. The API is read-only
  on the on-chain tables; it writes only to `token_metadata`, via its own drizzle handle.

### Curve → DEX lifecycle

A token trades on the bonding curve until it graduates, then on Uniswap V2. Both sides land in
the same `trades` table, discriminated by `source` (`'curve'` | `'dex'`), so charts, volume and
history stay continuous across graduation. The pair layout (`weth`, `sourceIsToken0`) is
resolved on-chain **once** at graduation and persisted on the `graduations` row, so the swap hot
path never hits RPC. The frontend mirrors the split: `useTradeFunctions` (curve, through the
launchpad) and `useDexSwapFunctions` (router `getAmountsOut` + swap).

## Quick start (local)

```sh
pnpm install
pnpm --filter @lcai/abis build       # consumers resolve dist/; the dev scripts also do this
```

Start a Postgres and point `DATABASE_URL` at it (there is no `postgres` service in
`docker-compose.yml`), then:

```sh
cp apps/api/.env.example     apps/api/.env
cp apps/indexer/.env.example apps/indexer/.env
```

Deploy the contracts (below) and note the printed **Launchpad proxy address + start block** —
set them in `apps/indexer/.env` (`LAUNCHPAD_ADDRESS`, `START_BLOCK`), and set
`LAUNCHPAD_ADDRESS` to the same value in `apps/api/.env` (used to exclude the launchpad from
"top holders" — it holds each token's unsold supply).

```sh
pnpm dev            # everything, via Turborepo
# …or one at a time:
pnpm dev:indexer    # Ponder backfills + live-indexes
pnpm dev:api        # Fastify on :3001, Swagger UI at /v1/docs
pnpm dev:frontend   # Next.js on :3000
```

Smoke test:

```sh
curl http://localhost:3001/v1/health
curl http://localhost:3001/v1/status
curl http://localhost:3001/v1/tokens
```

### Contracts

`contracts/` is **not** part of the pnpm workspace — it has its own `package-lock.json` and is
driven with npm from inside the directory. `hardhat.config.ts` sets
`defaultNetwork: "lcaiTestnet"`, so **always pass `--network`** or commands hit the live testnet.

```sh
cd contracts && npm install
npx hardhat compile
npx hardhat test --network hardhat            # full unit + graduation suite, uses in-repo Uniswap V2 mocks
REPORT_GAS=true npx hardhat test --network hardhat

npx hardhat node                              # then, in another shell:
DEX_ROUTER=0x… TREASURY=0x… npx hardhat run scripts/deploy.ts --network localhost
# DEX_ROUTER unset ⇒ deploys mock Uniswap V2 (handy on a fresh node)

FUNDING_GOAL=30 npx hardhat run scripts/calculateBondingCurve.ts   # curve param helper
```

The suite is self-contained; `ALCHEMY_API_KEY` only enables optional mainnet forking.
`viaIR` is on (the launch path is stack-heavy), and a 0.6.6 compiler is kept for Uniswap
periphery sources. See `contracts/docs/bonding-curve.md` for what the curve parameters mean.

After changing contracts, regenerate the ABIs so all three apps pick them up:

```sh
cd contracts && npx hardhat compile && cd ..
pnpm gen:abis && pnpm --filter @lcai/abis build
```

## REST endpoints (all under `/v1`)

| Method & path                              | Purpose                                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `GET  /tokens`                             | list — `search`, `tag`, `status`, `sort` (newest/oldest/marketCap/volume24h/lastTrade/graduating), `page`, `limit` |
| `GET  /tokens/trending`                    | trending feed                                                                                              |
| `GET  /tokens/:address`                    | detail + curve state + resolved metadata + volume24h / priceChange24hBps / holderCount                      |
| `GET  /tokens/:address/graduation`         | graduation record (pair, LP amounts, tx)                                                                    |
| `GET  /tokens/:address/trades`             | paginated trade history (curve + DEX)                                                                      |
| `GET  /tokens/:address/candles?interval=…` | OHLCV, TradingView-friendly; `1m 5m 15m 1h 4h 1d`                                                          |
| `GET  /tokens/:address/holders`            | top holders (launchpad / DEX pair / dead address excluded)                                                 |
| `GET  /trades`                             | global recent-trades feed                                                                                  |
| `GET  /accounts/:address`                  | tokens created / held / recent trades for an address                                                       |
| `GET  /search?q=`                          | name / symbol / address match                                                                              |
| `GET  /status`                             | indexer sync status (`indexedBlock`, `headBlock`, `lag`, `isSynced`)                                       |
| `GET  /health`                             | liveness / readiness                                                                                       |
| `POST /metadata`                           | **the only client→backend write** — multipart image + fields; pins both to Pinata, returns `{ uri: "ipfs://CID" }` (rate-limited) |
| `GET  /docs`                               | Swagger UI (OpenAPI generated from the route schemas)                                                      |

## Realtime stream (socket.io)

Connect a standard `socket.io-client` to the API origin (default path `/socket.io`, default
namespace), then `emit("subscribe", room | rooms[])`:

| Room               | Events                                              |
| ------------------ | --------------------------------------------------- |
| `token:<address>`  | `trade`, `token:update`, `token:graduated`          |
| `trades:all`       | `trade` (every trade across all tokens)             |
| `tokens:new`       | `token:new`                                         |
| `tokens:graduated` | `token:graduated`                                   |
| `status`           | `status` ticks (`indexedBlock`, `headBlock`, `lag`) |

```ts
import { io } from "socket.io-client";

const socket = io(API_URL, { transports: ["websocket"] });
socket.emit("subscribe", `token:${address.toLowerCase()}`);
socket.on("trade", ({ token, trade, tokenDTO }) => {
  // update UI…
});
```

Events are pushed as they're indexed (typically <200 ms). socket.io handles heartbeats and
reconnects; history is served by the REST endpoints. `emit("unsubscribe", room)` to leave;
disconnecting cleans up all rooms. Under the hood the indexer `pg_notify`s inside each
handler's transaction, the API holds one `postgres-js sql.listen(...)` on those channels, and
`realtime/registry` re-emits each payload as `io.to(room).emit(...)`. No polling, no cursors.

## Token-creation flow (the chain-derived guarantee)

1. Client form collects name, symbol, description, image, banner, website, twitter, telegram,
   discord, tags.
2. `POST /v1/metadata` → pin image to Pinata → build canonical metadata JSON → pin JSON →
   return `{ uri: "ipfs://CID", imageUri }`. **Rate-limited per IP; image ≤ 4 MB; all fields
   validated; social URLs https-only.** This is only pinning — the client asserts no
   authoritative token data.
3. Client calls `Launchpad.createToken(name, symbol, "ipfs://CID")` with
   `value = creationFee (+ optional devBuy)`.
4. Ponder indexes `TokenLaunched(token, creator, name, symbol, metadataUri, devBuyEth)` and
   inserts the `tokens` row entirely from on-chain data (the ERC20's real name/symbol are
   authoritative; the JSON's are display-fallback only). The handler reads `Launchpad.curves(token)`
   once for the curve config snapshot, then inserts a `token_metadata` row with
   `status='pending'`. A same-tx dev-buy `Trade` and a possible `Graduated` arrive as later
   events from the same launchpad address.
5. The indexer also `pg_notify`s `lcai:metadata:pending` in that transaction. The
   metadata-resolver (in-process in the API) is subscribed to that channel and resolves the new
   token **immediately** (tens of ms), claiming the row via `FOR UPDATE SKIP LOCKED`. A 60 s
   sweep timer is the fallback for retries and for catch-up after a listener reconnect. Per row:
   fetch the IPFS JSON, Zod-validate, re-pin to Pinata (best effort), update. Exponential
   backoff up to 8 attempts before `unavailable` — the token serves with on-chain data
   throughout. On success it fires `pg_notify('lcai:token:update', …)` so subscribers refresh.

## Workspace scripts

```sh
pnpm dev / build / lint / typecheck / format   # Turborepo, across every package
pnpm dev:indexer / dev:api / dev:frontend      # one app at a time
pnpm test                                      # pnpm -r test — vitest lives in apps/api
pnpm gen:abis                                  # regenerate packages/abis/src from contracts/artifacts
pnpm docker:up / docker:down / docker:logs     # builds + runs indexer and api images
```

Docker: copy `.env.example` to a root `.env` first. The `web` service is commented out in
`docker-compose.yml`, and there is no `postgres` service — supply your own instance. (The root
`db:up` / `db:down` and `compile:contracts` / `test:contracts` scripts are stale leftovers and
do not work.)

## Contributing

Contributions are welcome. Issues and pull requests both help.

**Setup.** `pnpm install` at the root wires up every workspace package. Copy the `.env.example`
next to each app you plan to run (`apps/api/`, `apps/indexer/`, `apps/web/`, `contracts/`) to
`.env` and fill in your own values. Never commit a real `.env` — only the `.example` templates
are tracked. If you add a new setting, add it to the matching `.env.example` with a placeholder
in the same PR.

**Before you open a PR**, from the repo root:

```sh
pnpm typecheck        # every package; the indexer's runs `ponder codegen` first
pnpm lint
pnpm test             # vitest, currently apps/api only
cd contracts && npx hardhat test --network hardhat   # if you touched Solidity
```

**House rules.**

- Match the surrounding style — the repo is Prettier-formatted (`pnpm format`) and ESLint runs
  from the shared `@lcai/eslint-config` presets. No separate style guide to memorise.
- Touching a contract means regenerating ABIs in the same commit:
  `cd contracts && npx hardhat compile && cd .. && pnpm gen:abis && pnpm --filter @lcai/abis build`.
  Leave the hand-maintained `uniswapV2Router02Abi` / `uniswapV2PairAbi` exports intact.
- The DB schema lives in exactly one file, `apps/indexer/ponder.schema.ts`. Change it there and
  let the API's typecheck tell you what broke — don't mirror definitions into the API.
- Ponder owns every table. If a change has the API writing to anything other than
  `token_metadata`, it's going the wrong way.
- New backend behaviour that clients rely on should be reachable through the REST/socket.io
  surface documented above, with the route schema updated so it shows up in `/v1/docs`.
- Solidity changes need test coverage in `contracts/test/`, including the failure paths — the
  suite runs against the in-repo Uniswap V2 mocks, so no fork or API key is needed.

**Reporting a bug.** Include the app (`api` / `indexer` / `web` / `contracts`), the chain and
launchpad address you were pointed at, and — for indexing problems — the block number and tx
hash, so the event can be replayed. Please redact keys and connection strings from any logs
you paste.

**Security issues** should be reported privately to the maintainers rather than filed as a
public issue, especially anything affecting `contracts/`, where a report becomes an exploit the
moment it's public.

## License

MIT — see [LICENSE](LICENSE).

## Notes

- v1 is chain-derived only — **no user-generated content, no auth**. Comments / watchlist / SIWE
  login would be v2: additional tables in `ponder.schema.ts` (or a separate app schema) served
  by the same Fastify service.
- The drizzle client uses `casing: "snake_case"` to match Ponder's column naming. There is a
  **single** schema definition in `apps/indexer/ponder.schema.ts`, imported by the API via
  `@lcai/indexer/schema`, so any column change lights up as an API typecheck error.
- Ponder's on-chain tables (`tokens`, `trades`, `graduations`, `holders`, `candles`) are
  read-only from the API — never write to them.
- A full Ponder reindex wipes `token_metadata`; the resolver re-fetches everything from IPFS on
  the next backfill (idempotent, accepted downside). If persistence across reindexes ever
  matters, extract that table to its own schema/migration.
- `packages/abis/src/*.ts` is generated **and committed**. `gen:abis` overwrites `launchpadAbi`
  and `tokenAbi` from the Hardhat artifacts; `uniswapV2Router02Abi` and `uniswapV2PairAbi` are
  hand-maintained and re-exported — don't let a regen drop them.
- `NEXT_PUBLIC_WEBSCOKET_URL` is misspelled consistently across the codebase; the typo is
  load-bearing. Unset, it falls back to `NEXT_PUBLIC_API_URL` with the `/v1` suffix trimmed
  (REST is under `/v1`, socket.io is at the server root).
- Realtime fan-out is single-process. To scale horizontally each API replica opens its own
  `LISTEN lcai:*` — Postgres delivers every NOTIFY to every connection, and clients are sticky
  to one replica, so no Redis adapter is needed for delivery. Add one only if cross-replica
  room state becomes necessary; at much higher load, swap pg_notify for Redis Pub/Sub.
