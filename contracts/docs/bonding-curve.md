# Bonding curve parameters & how to calculate them

This document explains the constant-product, virtual-reserve bonding curve used by the
monolithic `Launchpad.sol` (each token's curve state lives in a `Curve` struct keyed by the
token's address inside the launchpad), the parameters the `Launchpad` owner sets, and — in
particular — **whether you need to change `virtualTokenReserve` when you change `fundingGoal`**
(short answer: no) and **how to pick `virtualTokenReserve` when you actually do want to
reshape the curve**.

There is a helper script that does all of the arithmetic and validation for you:

```shell
FUNDING_GOAL=30 npx hardhat run scripts/calculateBondingCurve.ts
```

Read on if you want to understand what it's computing.

---

## 1. The curve

Every launch sells `maxSupplyForSale` (`M`) tokens along a constant-product curve defined by
two **virtual reserves**:

- `virtualEthReserve` (`VE`) — a virtual native-currency reserve (the "offset" that makes the
  first token cost something instead of zero),
- `virtualTokenReserve` (`VT`) — a virtual token reserve.

The product `k = VE · VT` is invariant. After a total of `e` native currency has gone into the
curve (net of trade fees) and `s` tokens have been released:

```
(VE + e) · (VT − s) = VE · VT
```

so the two are tied together:

```
s = VT · e / (VE + e)              tokens released after raising e
e = VE · s / (VT − s)              native raised after releasing s   ← `raisedAt(s)` in the contract
```

The **spot price** (`currentPriceX18()` in the contract, native wei per 1e18 token-wei) is

```
p(s) = (VE + e) / (VT − s) = VE · VT / (VT − s)²
```

Key facts that fall out of this:

| quantity | formula |
|---|---|
| initial spot price `p₀` | `VE / VT` |
| graduation spot price `p_M` | `VE · VT / (VT − M)²` |
| **spot price multiple, launch → graduation** | `p_M / p₀ = (VT / (VT − M))²` |
| average price over the whole sale | `fundingGoal / M` |
| initial market cap (price × total supply) | `(VE / VT) · totalSupply` |
| graduation market cap | `p_M · totalSupply` |

Note `M = totalSupply · (1 − lpBps / 1e4)` — the rest of the supply (`lpSupply`) is reserved
for the DEX pool created at graduation.

---

## 2. The consistency constraint (why `virtualEthReserve` is *derived*, not chosen)

A token graduates when **either** `e ≥ fundingGoal` **or** `s ≥ M`. For these to coincide —
i.e. the curve raises exactly `fundingGoal` by the time it sells out — we need
`raisedAt(M) = fundingGoal`:

```
VE · M / (VT − M) = fundingGoal      ⇒      VE = fundingGoal · (VT − M) / M
```

So **`virtualEthReserve` is not an independent input.** `Launchpad.setCurveParams` takes

```solidity
setCurveParams(totalSupply, lpBps, fundingGoal, virtualTokenReserve)
```

derives `virtualEthReserve = ceil(fundingGoal · (virtualTokenReserve − M) / M)` (rounding up so
`raisedAt(M) ≥ fundingGoal` — the curve graduates on the funding goal at, or a hair before,
selling out; any tiny unsold remainder is burned at graduation), and reverts if the result is
inconsistent or out of bounds. The old `TokenManager` took `INITIAL_ETH_RESERVE`,
`FUNDING_GOAL` and the token reserve as three *independent* hardcoded values that didn't line
up — that's the bug this design removes.

---

## 3. Do I need to change `virtualTokenReserve` when I change `fundingGoal`?

**No.** Just call `setCurveParams(...)` with the new `fundingGoal` and the same
`virtualTokenReserve`; `virtualEthReserve` is recomputed automatically.

What happens: `virtualEthReserve` scales **linearly** with `fundingGoal` (with `VT` and `M`
fixed), so the entire price curve scales linearly too — the starting price, the graduation
price, and the market cap at *every* point along the way all multiply by
`newFundingGoal / oldFundingGoal`. The **shape** of the curve is unchanged. In particular the
launch→graduation spot-price multiple

```
p_M / p₀ = (VT / (VT − M))²
```

depends only on `VT` and `M` — **not on `fundingGoal`**. So "double the funding goal" simply
means "the token raises twice as much native, and is valued twice as high at every point",
with the same curve aggressiveness.

`fundingGoal` is therefore best thought of as: **how much native a token raises before it
graduates to the DEX.** `virtualTokenReserve` is a *separate* knob: **how aggressive / steep
the curve is.**

---

## 4. When you *do* want to change `virtualTokenReserve` — how to pick it

You'd change `virtualTokenReserve` only to reshape the curve: a different launch→graduation
price multiple, or a different starting market cap relative to the funding goal.

With `totalSupply` and `lpBps` fixed (so `M` is fixed) and `virtualEthReserve` pinned by the
consistency constraint, **`virtualTokenReserve` is the single free "shape" parameter** — and the
two intuitions below are just two views of the same knob (pick whichever is easier to reason
about; one determines the other).

Let `R = VT / (VT − M)` (so the launch→graduation spot-price multiple is `R²`), and let
`S = totalSupply`, so `S / M = 1 / (1 − lpBps/1e4)` (with 20% LP that's `1.25`).

### a) Target a launch → graduation spot-price multiple

If you want the spot price to run by a factor of `m` from launch to graduation, set `R = √m`:

```
VT = M · R / (R − 1) = M · √m / (√m − 1)
```

### b) Target the initial market cap as a fraction of the funding goal

If you want the initial market cap to be `f × fundingGoal` (e.g. `f = 0.1` ⇒ a token that
graduates at a 30-native goal starts around a 3-native market cap):

```
f = (S / M) · (1 − M / VT)        ⇒        VT = M / ( 1 − f · M / S )
```

### The two are linked

```
f = (S / M) / R          equivalently        R = (S / M) / f
spot-price multiple m = R²
```

So with 20% LP (`S/M = 1.25`): picking `f = 0.32` gives `R ≈ 3.9` and `m ≈ 15×`; picking
`f = 0.0625` gives `R = 20` and `m = 400×`. You only get to choose one of `{ f, R, m }`; the
others follow.

---

## 5. Worked examples

`totalSupply = 1,000,000,000 · 1e18`, `lpBps = 2000` ⇒ `M = 800,000,000 · 1e18`,
`S / M = 1.25`. Token amounts below are in whole tokens; multiply by `1e18` for the on-chain
value.

| label | `virtualTokenReserve` | `R = VT/(VT−M)` | spot multiple `R²` | initial mcap / goal `f` | `fundingGoal` | derived `virtualEthReserve` | initial mcap | graduation mcap |
|---|---|---|---|---|---|---|---|---|
| **default** | 1,073,000,000 | 3.93 | ≈ 15.4× | 0.318 | 30 | 10.2375 | ≈ 9.54 | ≈ 147 |
| default, bigger goal | 1,073,000,000 | 3.93 | ≈ 15.4× | 0.318 | 100 | 34.125 | ≈ 31.8 | ≈ 491 |
| steeper (≈100× run) | 888,888,889 | 10.0 | 100× | 0.125 | 30 | 3.3333… | ≈ 3.75 | ≈ 375 |
| flatter (4× run) | 1,600,000,000 | 2.0 | 4× | 0.625 | 30 | 30.0 | ≈ 18.75 | ≈ 75 |

(The first two rows show the point from §3: same `virtualTokenReserve`, only `fundingGoal`
changed — the curve's shape is identical, everything just scales.)

`virtualEthReserve` above is `fundingGoal · (VT − M) / M` (the contract additionally rounds it
up by at most 1 wei).

---

## 6. Constraints the contract enforces

`setCurveParams` reverts unless:

- `lpBps ∈ [100, 5000]` (1%–50%);
- `fundingGoal ≥ MIN_FUNDING_GOAL` (1e15 wei = 0.001 native);
- `virtualTokenReserve ≥ M · 101 / 100` — i.e. `VT` must sit at least 1% above the for-sale
  supply. In shape terms this caps `R ≤ 101` (spot multiple ≲ 10,000×) — a `VT` too close to
  `M` makes `VT − M` tiny, the curve absurdly steep, and risks overflow;
- the derived `virtualEthReserve > 0` and `raisedAt(maxSupplyForSale) ≥ fundingGoal` (always
  true given the ceil, but checked defensively).

Trade-fee / graduation-fee caps are separate (`tradeFeeBps ≤ 1000`, `graduationFeeBps ≤ 2000`,
creator-share bps `≤ 1e4`) and live in `setFeeConfig`.

---

## 7. Putting it together

1. Decide `fundingGoal` (how much the token raises before graduating) and, if you care about
   it, a shape target — a launch→graduation price multiple `m`, or an initial-mcap-to-goal
   ratio `f`. Convert to `virtualTokenReserve` with §4 (or just keep the default
   `1,073,000,000 · 1e18`, which is the pump.fun-ish ≈15× shape).
2. Run the helper to get the validated tuple and a sanity report:
   ```shell
   FUNDING_GOAL=100 npx hardhat run scripts/calculateBondingCurve.ts
   # to also reshape:
   FUNDING_GOAL=100 VIRTUAL_TOKEN_RESERVE=888888889 npx hardhat run scripts/calculateBondingCurve.ts
   ```
   It prints `virtualEthReserve`, `raisedAt(maxSupplyForSale)` (must be ≥ the goal — it will
   be), the initial price/market cap, and the exact arguments for `setCurveParams`.
3. Apply it on-chain (owner only):
   ```solidity
   launchpad.setCurveParams(totalSupply, lpBps, fundingGoal, virtualTokenReserve);
   ```
   New launches use the new curve; curves already in flight keep the parameters they
   snapshotted at creation (each token's `Curve` struct freezes the config at
   `createToken` time).
