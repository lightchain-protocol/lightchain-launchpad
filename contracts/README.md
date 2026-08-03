# LCAI Launchpad — smart contracts

A pump.fun-style memecoin launchpad for the LightchainAI (LCAI) EVM chain.

## Contracts

- **`LaunchpadFactory.sol`** — UUPS-upgradeable control plane. Holds the global config
  (fees, treasury, curve params, anti-bot limits, DEX router), deploys a fresh `Token` and an
  immutable `BondingCurve` clone per launch, snapshots the config into the clone, optionally
  runs the creator's launch dev-buy, and exposes paginated listings. Owner-gated config and
  escape hatches; the per-token curves are *not* upgradeable (a new `BondingCurve`
  implementation only affects future launches).
- **`BondingCurve.sol`** — one immutable EIP-1167 clone per token. Sells the token along a
  constant-product, virtual-reserve curve; charges a configurable fee on every buy and sell
  (split between a protocol treasury and the token creator); refunds the surplus when a buy
  hits the for-sale cap; enforces optional anti-bot limits (max buy / max wallet / cooldown);
  and atomically graduates once the funding goal is hit or the for-sale supply is exhausted —
  creating a Uniswap-V2-style pool with the reserved LP supply + raised native (minus the
  graduation fee), burning the LP tokens, and burning any unsold supply.
- **`Token.sol`** — plain, ownerless `ERC20` + `ERC20Burnable`. Fixed supply, 18 decimals,
  full supply minted to the curve.
- **`lib/CurveMath.sol`** — pure curve / fee math with curve-favouring rounding.
- **`mocks/`** — minimal Uniswap V2 mocks + test helpers (used by the suite; the launchpad
  itself talks to a real Uniswap-V2-compatible router on chain).

## Commands

```shell
npm install
npx hardhat compile
npx hardhat test                     # full unit + graduation suite (uses the in-repo Uniswap V2 mocks)
REPORT_GAS=true npx hardhat test

# parameter helper — prints a consistent (totalSupply, lpBps, fundingGoal, virtualTokenReserve) tuple
# see docs/bonding-curve.md for what the parameters mean and how to choose them
FUNDING_GOAL=30 npx hardhat run scripts/calculateBondingCurve.ts

# deploy: BondingCurve impl -> LaunchpadFactory impl -> ERC1967 (UUPS) proxy, initialised
# DEX_ROUTER unset => deploys mock Uniswap V2 (handy on a fresh node)
npx hardhat node
DEX_ROUTER=0x... TREASURY=0x... npx hardhat run scripts/deploy.ts --network localhost
```

`hardhat.config.ts` compiles with `viaIR` (the factory's launch path is stack-heavy), keeps a
0.6.6 compiler around for Uniswap periphery sources, and only enables mainnet forking when
`ALCHEMY_API_KEY` is set (no `*.fork.ts` specs ship by default — the suite is self-contained).

## Notes for integrators (`api/`, `frontend/`)

This replaces the old single `TokenManager`. There is now a `LaunchpadFactory` address plus
one `BondingCurve` per token (`factory.getCurve(token)` or index the `TokenLaunched` event).
Key surface:

- `LaunchpadFactory.createToken(name, symbol, metadataURI) payable returns (token, curve)` —
  `msg.value >= creationFee`; the remainder is the optional dev-buy. Emits
  `TokenLaunched(token, curve, creator, name, symbol, metadataURI, devBuyEth)`.
- `BondingCurve.buy(minTokensOut) payable`, `buyFor(to, minTokensOut) payable` (factory only),
  `sell(tokenAmount, minEthOut)` (approve the curve first), `quoteBuy(ethIn)`,
  `quoteSell(tokenAmount)`, `currentPriceX18()`, `marketCap()`, `reserves()`, `state()`,
  `claimCreatorFees(to)`. Emits `Trade(token, user, isBuy, ethAmount, tokenAmount, feeAmount,
  priceX18, realEthRaised, tokensSold)` and `Graduated(token, pair, ethToLp, tokensToLp,
  tokensBurned, degradedPath)`.

After graduation the token trades on the Uniswap V2 pool (`curve.pair()`), not the curve.
