import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseEther, zeroAddress, type Address } from "viem";

import { deployLaunchpad, DEFAULTS, type DeployOpts } from "../scripts/deployLaunchpad";

const DEAD: Address = "0x000000000000000000000000000000000000dEaD";

// ---------------------------------------------------------------------------
// bigint comparison helpers (chai 4.x's numeric matchers don't reliably accept bigint)
// ---------------------------------------------------------------------------
const gt = (a: bigint, b: bigint) => expect(a > b, `expected ${a} > ${b}`).to.equal(true);
const gte = (a: bigint, b: bigint) => expect(a >= b, `expected ${a} >= ${b}`).to.equal(true);
const lt = (a: bigint, b: bigint) => expect(a < b, `expected ${a} < ${b}`).to.equal(true);
const lte = (a: bigint, b: bigint) => expect(a <= b, `expected ${a} <= ${b}`).to.equal(true);

const MAX_UINT = 2n ** 256n - 1n;
const farDeadline = () => BigInt(Math.floor(Date.now() / 1000) + 3600);

// ---------------------------------------------------------------------------
// fixtures & helpers
// ---------------------------------------------------------------------------
function makeFixture(opts: DeployOpts = {}) {
  return async function fixture() {
    const [deployer, alice, bob, carol] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();
    const dep = await deployLaunchpad(opts);
    return { ...dep, deployer, alice, bob, carol, publicClient };
  };
}
const baseFixture = makeFixture();

function launchedFixtureFor(opts: DeployOpts = {}) {
  return async function launchedFixture() {
    const [deployer, alice, bob, carol] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();
    const dep = await deployLaunchpad(opts);
    const tk = await launchToken(dep.launchpad, alice);
    return { ...dep, ...tk, deployer, alice, bob, carol, publicClient };
  };
}
const launchedFixture = launchedFixtureFor();

async function launchToken(launchpad: any, signer: any, devBuy: bigint = 0n) {
  const creationFee: bigint = await launchpad.read.creationFee();
  const value = creationFee + devBuy;
  const { result } = await launchpad.simulate.createToken(["MemeCoin", "MEME", "ipfs://meta"], {
    value,
    account: signer.account,
  });
  const tokenAddr = result as Address;
  await launchpad.write.createToken(["MemeCoin", "MEME", "ipfs://meta"], { value, account: signer.account });
  const token = await hre.viem.getContractAt("Token", tokenAddr);
  return { token, tokenAddr: getAddress(tokenAddr) };
}

const bal = (publicClient: any, addr: Address): Promise<bigint> => publicClient.getBalance({ address: addr });

/// Sum-across-all-tokens invariant: launchpad's native balance must cover every
/// non-graduated curve's backing + every curve's accrued creator fees + the
/// global protocol fees + the accrued creation fees.
async function checkBackingInvariant(launchpad: any, tokenAddrs: Address[], publicClient: any) {
  const b = await bal(publicClient, getAddress(launchpad.address));
  let totalBacking = 0n;
  let totalCreator = 0n;
  for (const t of tokenAddrs) {
    const isGrad: boolean = await launchpad.read.isGraduated([t]);
    if (!isGrad) totalBacking += (await launchpad.read.realEthRaisedOf([t])) as bigint;
    totalCreator += (await launchpad.read.creatorFeesOf([t])) as bigint;
  }
  const pf: bigint = await launchpad.read.protocolFees();
  const cef: bigint = await launchpad.read.accruedCreationFees();
  gte(b, totalBacking + totalCreator + pf + cef);
}

// ===========================================================================
describe("Launchpad", () => {
  // -------------------------------------------------------------------------
  describe("deployment & config", () => {
    it("initializes with the supplied config and derives a consistent curve", async () => {
      const { launchpad, deployer, mockDex } = await loadFixture(baseFixture);
      expect(await launchpad.read.owner()).to.equal(getAddress(deployer.account.address));
      expect(await launchpad.read.creationFee()).to.equal(DEFAULTS.creationFee);
      expect(await launchpad.read.tradeFeeBps()).to.equal(DEFAULTS.tradeFeeBps);
      expect(await launchpad.read.graduationFeeBps()).to.equal(DEFAULTS.graduationFeeBps);
      expect(await launchpad.read.dexRouter()).to.equal(getAddress(mockDex!.router.address));
      const ve: bigint = await launchpad.read.virtualEthReserve();
      const vt: bigint = await launchpad.read.virtualTokenReserve();
      const m: bigint = await launchpad.read.maxSupplyForSale();
      gt(ve, 0n);
      gte((ve * m) / (vt - m), DEFAULTS.fundingGoal); // raisedAt(M) >= fundingGoal
    });

    it("rejects inconsistent / out-of-range curve params and accepts valid ones", async () => {
      const { launchpad } = await loadFixture(baseFixture);
      await expect(
        launchpad.write.setCurveParams([DEFAULTS.totalSupply, 2000, DEFAULTS.fundingGoal, (DEFAULTS.totalSupply * 8n) / 10n])
      ).to.be.rejected; // virtualTokenReserve too small vs maxSupplyForSale
      await expect(
        launchpad.write.setCurveParams([DEFAULTS.totalSupply, 50, DEFAULTS.fundingGoal, DEFAULTS.virtualTokenReserve])
      ).to.be.rejected; // lpBps out of [100, 5000]
      await expect(
        launchpad.write.setCurveParams([DEFAULTS.totalSupply, 2000, 1n, DEFAULTS.virtualTokenReserve])
      ).to.be.rejected; // fundingGoal below MIN_FUNDING_GOAL
      await launchpad.write.setCurveParams([DEFAULTS.totalSupply, 2500, parseEther("50"), DEFAULTS.virtualTokenReserve]);
      expect(await launchpad.read.fundingGoal()).to.equal(parseEther("50"));
      expect(await launchpad.read.lpBps()).to.equal(2500);
      gt(await launchpad.read.virtualEthReserve(), 0n);
    });

    it("enforces fee caps", async () => {
      const { launchpad } = await loadFixture(baseFixture);
      await expect(launchpad.write.setFeeConfig([0n, 1001, 100, 5000, 5000])).to.be.rejected; // tradeFee > 10%
      await expect(launchpad.write.setFeeConfig([0n, 100, 2001, 5000, 5000])).to.be.rejected; // gradFee > 20%
      await expect(launchpad.write.setFeeConfig([0n, 100, 100, 10001, 5000])).to.be.rejected; // creator share > 100%
      await launchpad.write.setFeeConfig([parseEther("0.02"), 200, 150, 4000, 6000]);
      expect(await launchpad.read.creationFee()).to.equal(parseEther("0.02"));
      expect(await launchpad.read.tradeFeeBps()).to.equal(200);
    });

    it("sets the treasury at deployment and rotates it via an owner-only setter", async () => {
      const { launchpad, deployer, alice, carol } = await loadFixture(baseFixture);
      // set at construction, from InitArgs.treasury (defaults to the owner)
      expect(getAddress(await launchpad.read.treasury())).to.equal(getAddress(deployer.account.address));

      await expect(launchpad.write.setTreasury([getAddress(carol.account.address)], { account: alice.account })).to.be
        .rejected; // not owner
      await expect(launchpad.write.setTreasury([zeroAddress])).to.be.rejected; // zero treasury

      await launchpad.write.setTreasury([getAddress(carol.account.address)]);
      expect(getAddress(await launchpad.read.treasury())).to.equal(getAddress(carol.account.address));

      // rotating the treasury must not disturb the fee rates
      expect(await launchpad.read.tradeFeeBps()).to.equal(DEFAULTS.tradeFeeBps);
      expect(await launchpad.read.creationFee()).to.equal(DEFAULTS.creationFee);
    });

    it("gates owner-only functions", async () => {
      const { launchpad, alice } = await loadFixture(baseFixture);
      await expect(launchpad.write.setAntiBot([0n, 0, 0], { account: alice.account })).to.be.rejected;
      await expect(launchpad.write.pause({ account: alice.account })).to.be.rejected;
      await expect(launchpad.write.setDexRouter([zeroAddress], { account: alice.account })).to.be.rejected;
      await expect(launchpad.write.withdrawCreationFees({ account: alice.account })).to.be.rejected;
      await expect(launchpad.write.setTreasury([getAddress(alice.account.address)], { account: alice.account })).to.be
        .rejected;
    });

    it("rejects a zero DEX router", async () => {
      const { launchpad } = await loadFixture(baseFixture);
      await expect(launchpad.write.setDexRouter([zeroAddress])).to.be.rejected;
    });
  });

  // -------------------------------------------------------------------------
  describe("createToken & dev-buy", () => {
    it("reverts when msg.value < creationFee", async () => {
      const { launchpad, alice } = await loadFixture(baseFixture);
      await expect(launchpad.write.createToken(["A", "A", ""], { value: 0n, account: alice.account })).to.be.rejected;
    });

    it("launches a token, mints full supply to the launchpad, records mappings, pays the fee", async () => {
      const { launchpad, alice } = await loadFixture(baseFixture);
      const { token, tokenAddr } = await launchToken(launchpad, alice);
      expect(await token.read.totalSupply()).to.equal(DEFAULTS.totalSupply);
      expect(await token.read.balanceOf([getAddress(launchpad.address)])).to.equal(DEFAULTS.totalSupply);
      expect(getAddress(await launchpad.read.creatorOf([tokenAddr]))).to.equal(getAddress(alice.account.address));
      expect(await launchpad.read.totalTokens()).to.equal(1n);
      // creation fee is pushed to the treasury, so nothing is left to pull
      expect(await launchpad.read.accruedCreationFees()).to.equal(0n);
      expect(await launchpad.read.isGraduated([tokenAddr])).to.equal(false);
      expect(await launchpad.read.fundingGoalOf([tokenAddr])).to.equal(DEFAULTS.fundingGoal);
    });

    it("performs the creator dev-buy atomically", async () => {
      const { launchpad, alice, publicClient } = await loadFixture(baseFixture);
      const { token, tokenAddr } = await launchToken(launchpad, alice, parseEther("1"));
      const aliceBal: bigint = await token.read.balanceOf([getAddress(alice.account.address)]);
      gt(aliceBal, 0n);
      expect(await launchpad.read.tokensSoldOf([tokenAddr])).to.equal(aliceBal);
      // net into the curve = 1 ether - 1% fee = 0.99 ether (exact, no clamp)
      expect(await launchpad.read.realEthRaisedOf([tokenAddr])).to.equal(parseEther("0.99"));
      // trade fee = 0.01 ether; creator share = 50%
      expect(await launchpad.read.creatorFeesOf([tokenAddr])).to.equal(parseEther("0.005"));
      expect(await launchpad.read.protocolFees()).to.equal(parseEther("0.005"));
      await checkBackingInvariant(launchpad, [tokenAddr], publicClient);
    });

    it("a dev-buy that overshoots refunds the creator and graduates in the same tx", async () => {
      const { launchpad, alice, publicClient } = await loadFixture(baseFixture);
      const before = await bal(publicClient, getAddress(alice.account.address));
      const creationFee: bigint = await launchpad.read.creationFee();
      const value = creationFee + parseEther("45");
      const { result } = await launchpad.simulate.createToken(["Big", "BIG", ""], { value, account: alice.account.address });
      const tokenAddr = result as Address;
      const hash = await launchpad.write.createToken(["Big", "BIG", ""], { value, account: alice.account });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const gas = receipt.gasUsed * receipt.effectiveGasPrice;
      const after = await bal(publicClient, getAddress(alice.account.address));
      const token = await hre.viem.getContractAt("Token", tokenAddr);
      expect(await launchpad.read.isGraduated([tokenAddr])).to.equal(true);
      lt(before - after - gas, creationFee + parseEther("35")); // surplus refunded
      expect(await token.read.balanceOf([getAddress(alice.account.address)])).to.equal(
        await launchpad.read.maxSupplyForSaleOf([tokenAddr])
      );
      await checkBackingInvariant(launchpad, [getAddress(tokenAddr)], publicClient);
    });

    it("paginates getTokens", async () => {
      const { launchpad, alice, bob } = await loadFixture(baseFixture);
      await launchToken(launchpad, alice);
      await launchToken(launchpad, bob);
      const [tokens, total] = (await launchpad.read.getTokens([0n, 10n])) as [Address[], bigint];
      expect(total).to.equal(2n);
      expect(tokens.length).to.equal(2);
      const [tokens2] = (await launchpad.read.getTokens([1n, 10n])) as [Address[], bigint];
      expect(tokens2.length).to.equal(1);
      const [tokens3] = (await launchpad.read.getTokens([5n, 10n])) as [Address[], bigint];
      expect(tokens3.length).to.equal(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("buy / sell", () => {
    it("buys tokens, updates reserves, splits the fee", async () => {
      const { launchpad, token, tokenAddr, bob, publicClient } = await loadFixture(launchedFixture);
      const [tokensOut, ethInNet, fee] = (await launchpad.read.quoteBuy([tokenAddr, parseEther("1")]));
      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("1"), account: bob.account });
      expect(await token.read.balanceOf([getAddress(bob.account.address)])).to.equal(tokensOut);
      expect(await launchpad.read.realEthRaisedOf([tokenAddr])).to.equal(ethInNet);
      expect(await launchpad.read.tokensSoldOf([tokenAddr])).to.equal(tokensOut);
      const creatorCut = (fee * 5000n) / 10000n;
      expect(await launchpad.read.creatorFeesOf([tokenAddr])).to.equal(creatorCut);
      expect(await launchpad.read.protocolFees()).to.equal(fee - creatorCut);
      await checkBackingInvariant(launchpad, [tokenAddr], publicClient);
    });

    it("enforces minTokensOut on buys", async () => {
      const { launchpad, tokenAddr, bob } = await loadFixture(launchedFixture);
      const [tokensOut] = (await launchpad.read.quoteBuy([tokenAddr, parseEther("1")]));
      await expect(launchpad.write.buy([tokenAddr, tokensOut + 1n], { value: parseEther("1"), account: bob.account })).to.be
        .rejected;
    });

    it("quoteBuyForTokens returns a gross that buys at least the requested tokens", async () => {
      const { launchpad, token, tokenAddr, bob } = await loadFixture(launchedFixture);
      const want = parseEther("1234567.89");
      const [ethIn, ethInNet, fee] = (await launchpad.read.quoteBuyForTokens([tokenAddr, want])) as [
        bigint,
        bigint,
        bigint,
      ];
      expect(ethIn).to.equal(ethInNet + fee);

      // Matches the fee split `buy` / `quoteBuy` apply (feeOf), not ethIn - getAmountIn.
      const [tokensFromGross, ethInNetFromBuy, feeFromBuy] = (await launchpad.read.quoteBuy([
        tokenAddr,
        ethIn,
      ])) as [bigint, bigint, bigint, bigint];
      expect(ethInNetFromBuy).to.equal(ethInNet);
      expect(feeFromBuy).to.equal(fee);
      gte(tokensFromGross, want);

      await launchpad.write.buy([tokenAddr, want], { value: ethIn, account: bob.account });
      gte(await token.read.balanceOf([getAddress(bob.account.address)]), want);
    });

    it("quoteBuyForTokens round-trips a quoteBuy fill without overpaying", async () => {
      const { launchpad, tokenAddr } = await loadFixture(launchedFixture);
      const ethSpend = parseEther("1");
      const [tokensOut] = (await launchpad.read.quoteBuy([tokenAddr, ethSpend])) as [
        bigint,
        bigint,
        bigint,
        bigint,
      ];
      const [ethIn] = (await launchpad.read.quoteBuyForTokens([tokenAddr, tokensOut])) as [
        bigint,
        bigint,
        bigint,
      ];
      // May be 0–a few wei under the original spend from fee flooring; never more.
      lte(ethIn, ethSpend);
      const [tokensAgain] = (await launchpad.read.quoteBuy([tokenAddr, ethIn])) as [
        bigint,
        bigint,
        bigint,
        bigint,
      ];
      gte(tokensAgain, tokensOut);
    });

    it("quoteBuyForTokens reverts when asking for more than remaining for-sale supply", async () => {
      const { launchpad, tokenAddr } = await loadFixture(launchedFixture);
      const remaining: bigint = await launchpad.read.maxSupplyForSaleOf([tokenAddr]);
      await expect(launchpad.read.quoteBuyForTokens([tokenAddr, remaining + 1n])).to.be.rejected;
      await expect(launchpad.read.quoteBuyForTokens([tokenAddr, 0n])).to.be.rejected;
    });

    it("reverts on a zero-value buy", async () => {
      const { launchpad, tokenAddr, bob } = await loadFixture(launchedFixture);
      await expect(launchpad.write.buy([tokenAddr, 0n], { value: 0n, account: bob.account })).to.be.rejected;
    });

    it("sells tokens back for the quoted net amount", async () => {
      const { launchpad, token, tokenAddr, bob, publicClient } = await loadFixture(launchedFixture);
      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("3"), account: bob.account });
      const b: bigint = await token.read.balanceOf([getAddress(bob.account.address)]);
      await token.write.approve([getAddress(launchpad.address), b], { account: bob.account });
      const [ethOutNet] = (await launchpad.read.quoteSell([tokenAddr, b]));
      const before = await bal(publicClient, getAddress(bob.account.address));
      const hash = await launchpad.write.sell([tokenAddr, b, 0n], { account: bob.account });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const gas = receipt.gasUsed * receipt.effectiveGasPrice;
      const after = await bal(publicClient, getAddress(bob.account.address));
      expect(after - before + gas).to.equal(ethOutNet);
      expect(await token.read.balanceOf([getAddress(bob.account.address)])).to.equal(0n);
      expect(await launchpad.read.tokensSoldOf([tokenAddr])).to.equal(0n);
      await checkBackingInvariant(launchpad, [tokenAddr], publicClient);
    });

    it("buying e then selling all returns < e (never more)", async () => {
      const { launchpad, token, tokenAddr, bob } = await loadFixture(launchedFixture);
      const e = parseEther("2");
      await launchpad.write.buy([tokenAddr, 0n], { value: e, account: bob.account });
      const b: bigint = await token.read.balanceOf([getAddress(bob.account.address)]);
      await token.write.approve([getAddress(launchpad.address), b], { account: bob.account });
      const [ethOutNet] = (await launchpad.read.quoteSell([tokenAddr, b]));
      lt(ethOutNet, e);
      gt(ethOutNet, (e * 95n) / 100n); // sanity: just fee (1%) + small curve loss
    });

    it("enforces minEthOut & requires approval on sells", async () => {
      const { launchpad, token, tokenAddr, bob } = await loadFixture(launchedFixture);
      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("1"), account: bob.account });
      const b: bigint = await token.read.balanceOf([getAddress(bob.account.address)]);
      await expect(launchpad.write.sell([tokenAddr, b, 0n], { account: bob.account })).to.be.rejected; // no approval
      await token.write.approve([getAddress(launchpad.address), b], { account: bob.account });
      const [ethOutNet] = (await launchpad.read.quoteSell([tokenAddr, b]));
      await expect(launchpad.write.sell([tokenAddr, b, ethOutNet + 1n], { account: bob.account })).to.be.rejected; // slippage
    });

    it("keeps the backing invariant across a mixed buy/sell sequence", async () => {
      const { launchpad, token, tokenAddr, bob, carol, publicClient } = await loadFixture(launchedFixture);
      const steps: Array<["buy" | "sell", any, bigint]> = [
        ["buy", bob, parseEther("1.5")],
        ["buy", carol, parseEther("0.3")],
        ["buy", bob, parseEther("4")],
        ["sell", carol, 0n],
        ["buy", carol, parseEther("2")],
        ["sell", bob, 0n],
      ];
      for (const [kind, who, amt] of steps) {
        if (kind === "buy") {
          await launchpad.write.buy([tokenAddr, 0n], { value: amt, account: who.account });
        } else {
          const b: bigint = await token.read.balanceOf([getAddress(who.account.address)]);
          if (b === 0n) continue;
          await token.write.approve([getAddress(launchpad.address), b], { account: who.account });
          await launchpad.write.sell([tokenAddr, b, 0n], { account: who.account });
        }
        await checkBackingInvariant(launchpad, [tokenAddr], publicClient);
      }
    });

    it("graduates on the funding goal: clamps, refunds, seeds & burns the LP, closes curve trading", async () => {
      const { launchpad, token, tokenAddr, bob, publicClient } = await loadFixture(launchedFixture);
      const m: bigint = await launchpad.read.maxSupplyForSaleOf([tokenAddr]);
      const lpSupply: bigint = await launchpad.read.lpSupplyOf([tokenAddr]);
      const before = await bal(publicClient, getAddress(bob.account.address));
      const hash = await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("40"), account: bob.account });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const gas = receipt.gasUsed * receipt.effectiveGasPrice;
      const after = await bal(publicClient, getAddress(bob.account.address));

      expect(await launchpad.read.isGraduated([tokenAddr])).to.equal(true);
      expect(await token.read.balanceOf([getAddress(bob.account.address)])).to.equal(m); // clamped to the for-sale supply
      lt(before - after - gas, parseEther("35")); // refunded the surplus
      expect(await token.read.balanceOf([getAddress(launchpad.address)])).to.equal(0n); // launchpad emptied of this token

      const pairAddr = (await launchpad.read.pairOf([tokenAddr])) as Address;
      expect(pairAddr).to.not.equal(zeroAddress);
      expect(await token.read.balanceOf([pairAddr])).to.equal(lpSupply);
      const pair = await hre.viem.getContractAt("MockUniswapV2Pair", pairAddr);
      expect(await pair.read.balanceOf([getAddress(launchpad.address)])).to.equal(0n);
      gt(await pair.read.balanceOf([DEAD]), 0n); // LP burned

      await expect(launchpad.write.buy([tokenAddr, 0n], { value: parseEther("1"), account: bob.account })).to.be.rejected;
      await expect(launchpad.write.sell([tokenAddr, 1n, 0n], { account: bob.account })).to.be.rejected;

      // after graduation the launchpad's native balance equals fees only (creator + protocol + creation)
      const pf: bigint = await launchpad.read.protocolFees();
      const cf: bigint = await launchpad.read.creatorFeesOf([tokenAddr]);
      const cef: bigint = await launchpad.read.accruedCreationFees();
      expect(await bal(publicClient, getAddress(launchpad.address))).to.equal(pf + cf + cef);
      await checkBackingInvariant(launchpad, [tokenAddr], publicClient);
    });

    it("graduates fine when the pool was pre-created (anti-brick)", async () => {
      const { launchpad, token, tokenAddr, bob, mockDex } = await loadFixture(launchedFixture);
      const weth = getAddress(mockDex!.weth.address);
      await mockDex!.factory.write.createPair([getAddress(token.address), weth]);
      const preCreated = (await mockDex!.factory.read.getPair([getAddress(token.address), weth])) as Address;
      expect(preCreated).to.not.equal(zeroAddress);
      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("40"), account: bob.account });
      expect(await launchpad.read.isGraduated([tokenAddr])).to.equal(true);
      expect(getAddress(await launchpad.read.pairOf([tokenAddr]))).to.equal(getAddress(preCreated));
    });

    // Creating AND funding the pair is permissionless, and the token address is
    // public from TokenLaunched onward. A pre-seeded pool lets an attacker
    // choose the ratio the launchpad deposits at — so the normal path must
    // refuse to deposit at all rather than donate the raise to it.
    it("reverts graduation when the pair was pre-seeded with real reserves", async () => {
      const { launchpad, token, tokenAddr, bob, carol, mockDex } = await loadFixture(launchedFixture);
      const router = mockDex!.router;

      // attacker buys a little on the curve just to obtain tokens...
      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("1"), account: carol.account });
      // ...then seeds the pair at an absurd price: 1000 wei of token vs 5 native
      await token.write.approve([getAddress(router.address), MAX_UINT], { account: carol.account });
      await router.write.addLiquidityETH(
        [tokenAddr, 1000n, 0n, 0n, getAddress(carol.account.address), farDeadline()],
        { value: parseEther("5"), account: carol.account },
      );

      // must be the deliberate error, not a division-by-zero panic
      await expect(
        launchpad.write.buy([tokenAddr, 0n], { value: parseEther("40"), account: bob.account }),
      ).to.be.rejectedWith(/PairPreSeeded/);
      expect(await launchpad.read.isGraduated([tokenAddr])).to.equal(false);
    });

    // A single wei of donated WETH leaves the token-side reserve at 0, which
    // would make every UniswapV2 _addLiquidity divide by zero and strand the
    // curve forever. It must self-heal with no owner action — the whole point is
    // that a 1-wei grief cannot require a governance proposal to undo.
    it("self-heals a native-only donated reserve with no owner action", async () => {
      const { launchpad, token, tokenAddr, bob, carol, mockDex } = await loadFixture(launchedFixture);
      const wethC = mockDex!.weth;
      const weth = getAddress(wethC.address);

      await mockDex!.factory.write.createPair([tokenAddr, weth]);
      const pair = getAddress((await mockDex!.factory.read.getPair([tokenAddr, weth])) as Address);

      await wethC.write.deposit({ value: 1n, account: carol.account });
      await wethC.write.transfer([pair, 1n], { account: carol.account });
      await (await hre.viem.getContractAt("MockUniswapV2Pair", pair)).write.syncFromBalances();

      // ordinary buy graduates straight through
      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("40"), account: bob.account });
      expect(await launchpad.read.isGraduated([tokenAddr])).to.equal(true);

      // the pool is real on both sides, and the full LP allocation reached it
      const lpSupply: bigint = await launchpad.read.lpSupplyOf([tokenAddr]);
      gte(await token.read.balanceOf([pair]), lpSupply);
      gt(await wethC.read.balanceOf([pair]), 0n);
      expect(await token.read.balanceOf([getAddress(launchpad.address)])).to.equal(0n);
    });

    // Both sides funded can't be neutralised losslessly — the launchpad has no
    // spare native to rebalance with — so it stays a deliberate revert with a
    // human decision behind it.
    it("owner can graduate a token whose pair was pre-seeded on both sides", async () => {
      const { launchpad, token, tokenAddr, deployer, bob, carol, mockDex } =
        await loadFixture(launchedFixture);
      const router = mockDex!.router;

      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("1"), account: carol.account });
      await token.write.approve([getAddress(router.address), MAX_UINT], { account: carol.account });
      await router.write.addLiquidityETH(
        [tokenAddr, 1000n, 0n, 0n, getAddress(carol.account.address), farDeadline()],
        { value: parseEther("5"), account: carol.account },
      );

      // normal path refuses
      await expect(
        launchpad.write.buy([tokenAddr, 0n], { value: parseEther("40"), account: bob.account }),
      ).to.be.rejectedWith(/PairPreSeeded/);

      // owner path recovers it, at bounds they chose
      await launchpad.write.graduateByOwner([tokenAddr, 0n, 0n], { account: deployer.account });
      expect(await launchpad.read.isGraduated([tokenAddr])).to.equal(true);
      const pair = getAddress(await launchpad.read.pairOf([tokenAddr]));
      gt(await token.read.balanceOf([pair]), 0n);
      gt(await mockDex!.weth.read.balanceOf([pair]), 0n);
    });

    it("deposits the entire LP supply and the entire post-fee raise into a fresh pair", async () => {
      const { launchpad, token, tokenAddr, bob, mockDex } = await loadFixture(launchedFixture);
      const lpSupply: bigint = await launchpad.read.lpSupplyOf([tokenAddr]);

      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("40"), account: bob.account });
      expect(await launchpad.read.isGraduated([tokenAddr])).to.equal(true);

      const pair = getAddress(await launchpad.read.pairOf([tokenAddr]));
      // the whole intended LP allocation reached the pool — nothing skimmed, nothing burned
      expect(await token.read.balanceOf([pair])).to.equal(lpSupply);
      gt(await mockDex!.weth.read.balanceOf([pair]), 0n);
    });

    it("supports exact-token buys via swapETHForExactTokens after graduation", async () => {
      const { launchpad, token, tokenAddr, bob, carol, mockDex } = await loadFixture(launchedFixture);
      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("40"), account: bob.account });

      const router = mockDex!.router;
      const weth = getAddress(mockDex!.weth.address);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      const pathBuy = [weth, tokenAddr] as const;
      const want = parseEther("1000");
      const amountsIn = (await router.read.getAmountsIn([want, pathBuy])) as readonly bigint[];
      gt(amountsIn[0]!, 0n);

      const before = (await token.read.balanceOf([getAddress(carol.account.address)])) as bigint;
      await router.write.swapETHForExactTokens(
        [want, [...pathBuy], getAddress(carol.account.address), deadline],
        { value: amountsIn[0]! * 2n, account: carol.account },
      );
      expect(await token.read.balanceOf([getAddress(carol.account.address)])).to.equal(before + want);
    });

    it("supports post-graduation swaps via the mock Uniswap V2 router", async () => {
      const { launchpad, token, tokenAddr, bob, carol, mockDex, publicClient } = await loadFixture(launchedFixture);
      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("40"), account: bob.account });
      expect(await launchpad.read.isGraduated([tokenAddr])).to.equal(true);

      const router = mockDex!.router;
      const weth = getAddress(mockDex!.weth.address);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      const pathBuy = [weth, tokenAddr] as const;
      const pathSell = [tokenAddr, weth] as const;

      const buyIn = parseEther("1");
      const amountsBuy = (await router.read.getAmountsOut([buyIn, pathBuy])) as readonly bigint[];
      gt(amountsBuy[1]!, 0n);

      const tokensBefore = (await token.read.balanceOf([getAddress(carol.account.address)])) as bigint;
      await router.write.swapExactETHForTokens(
        [amountsBuy[1]!, [...pathBuy], getAddress(carol.account.address), deadline],
        { value: buyIn, account: carol.account },
      );
      const tokensAfter = (await token.read.balanceOf([getAddress(carol.account.address)])) as bigint;
      expect(tokensAfter - tokensBefore).to.equal(amountsBuy[1]!);

      const sellAmount = tokensAfter;
      await token.write.approve([getAddress(router.address), sellAmount], { account: carol.account });
      const amountsSell = (await router.read.getAmountsOut([sellAmount, pathSell])) as readonly bigint[];
      gt(amountsSell[1]!, 0n);

      const ethBefore = await bal(publicClient, getAddress(carol.account.address));
      const hash = await router.write.swapExactTokensForETH(
        [sellAmount, 0n, [...pathSell], getAddress(carol.account.address), deadline],
        { account: carol.account },
      );
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const gas = receipt.gasUsed * receipt.effectiveGasPrice;
      const ethAfter = await bal(publicClient, getAddress(carol.account.address));
      expect(ethAfter + gas - ethBefore).to.equal(amountsSell[1]!);
      expect(await token.read.balanceOf([getAddress(carol.account.address)])).to.equal(0n);
    });

    it("blocks reentrancy on the buy refund path", async () => {
      const { launchpad, alice } = await loadFixture(baseFixture);
      const { tokenAddr } = await launchToken(launchpad, alice);
      const attacker = await hre.viem.deployContract("ReentrantBuyer", []);
      await attacker.write.setTarget([getAddress(launchpad.address), tokenAddr]);
      await expect(attacker.write.attackBuy([0n], { value: parseEther("40") })).to.be.rejected;
      expect(await launchpad.read.isGraduated([tokenAddr])).to.equal(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("anti-bot limits", () => {
    it("enforces maxBuyPerTx and disables it at 0", async () => {
      const { launchpad, alice, bob } = await loadFixture(makeFixture({ maxBuyPerTx: parseEther("0.5") }));
      const { tokenAddr } = await launchToken(launchpad, alice);
      await expect(launchpad.write.buy([tokenAddr, 0n], { value: parseEther("1"), account: bob.account })).to.be
        .rejected; // ~0.99 net > 0.5
      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("0.4"), account: bob.account }); // ~0.396 net <= 0.5
      await launchpad.write.setAntiBot([0n, 0, 0]);
      // setAntiBot only affects FUTURE launches (per-curve snapshot); a freshly
      // launched token should now have anti-bot disabled.
      const { tokenAddr: tokenAddr2 } = await launchToken(launchpad, alice);
      await launchpad.write.buy([tokenAddr2, 0n], { value: parseEther("3"), account: bob.account });
    });

    it("enforces maxWalletBps but lets the graduating buy bypass it", async () => {
      const { launchpad, alice, bob } = await loadFixture(makeFixture({ maxWalletBps: 100 })); // 1% of for-sale supply
      const { token, tokenAddr } = await launchToken(launchpad, alice);
      const cap: bigint = ((DEFAULTS.totalSupply * 8n) / 10n) / 100n;
      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("0.01"), account: bob.account });
      lt(await token.read.balanceOf([getAddress(bob.account.address)]), cap);
      await expect(launchpad.write.buy([tokenAddr, 0n], { value: parseEther("1"), account: bob.account })).to.be
        .rejected; // over cap
      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("40"), account: bob.account }); // graduating buy bypasses the cap
      expect(await launchpad.read.isGraduated([tokenAddr])).to.equal(true);
      gt(await token.read.balanceOf([getAddress(bob.account.address)]), cap);
    });

    it("enforces tradeCooldown per address and disables it at 0", async () => {
      const { launchpad, alice, bob } = await loadFixture(makeFixture({ tradeCooldown: 60 }));
      const { tokenAddr } = await launchToken(launchpad, alice);
      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("0.1"), account: bob.account });
      await expect(launchpad.write.buy([tokenAddr, 0n], { value: parseEther("0.1"), account: bob.account })).to.be
        .rejected; // cooldown
      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("0.1"), account: alice.account }); // a different trader is unaffected
      await time.increase(61);
      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("0.1"), account: bob.account }); // ok now
    });
  });

  // -------------------------------------------------------------------------
  describe("cross-token isolation", () => {
    it("buying on token A never moves token B's reserves or fees", async () => {
      const { launchpad, alice, bob, publicClient } = await loadFixture(baseFixture);
      const { tokenAddr: tokA } = await launchToken(launchpad, alice);
      const { tokenAddr: tokB } = await launchToken(launchpad, bob);

      const beforeA = await launchpad.read.realEthRaisedOf([tokA]);
      const beforeB = await launchpad.read.realEthRaisedOf([tokB]);
      const beforeCreatorA = await launchpad.read.creatorFeesOf([tokA]);
      const beforeCreatorB = await launchpad.read.creatorFeesOf([tokB]);

      await launchpad.write.buy([tokA, 0n], { value: parseEther("1"), account: bob.account });

      expect(await launchpad.read.realEthRaisedOf([tokB])).to.equal(beforeB); // B untouched
      expect(await launchpad.read.creatorFeesOf([tokB])).to.equal(beforeCreatorB); // B's creator unchanged
      gt(await launchpad.read.realEthRaisedOf([tokA]), beforeA as bigint); // A grew
      gt(await launchpad.read.creatorFeesOf([tokA]), beforeCreatorA as bigint); // A's creator grew

      await checkBackingInvariant(launchpad, [tokA, tokB], publicClient);
    });

    it("per-token cooldown is independent (cooldown on A does not gate B)", async () => {
      const { launchpad, alice, bob } = await loadFixture(makeFixture({ tradeCooldown: 60 }));
      const { tokenAddr: tokA } = await launchToken(launchpad, alice);
      const { tokenAddr: tokB } = await launchToken(launchpad, alice);
      await launchpad.write.buy([tokA, 0n], { value: parseEther("0.1"), account: bob.account });
      await expect(launchpad.write.buy([tokA, 0n], { value: parseEther("0.1"), account: bob.account })).to.be.rejected; // cooldown on A
      // same wallet can trade B immediately — the cooldown is per (token, user)
      await launchpad.write.buy([tokB, 0n], { value: parseEther("0.1"), account: bob.account });
    });

    it("funds invariant holds after a multi-token mixed buy/sell scenario", async () => {
      const { launchpad, alice, bob, carol, publicClient } = await loadFixture(baseFixture);
      const { token: tokAContract, tokenAddr: tokA } = await launchToken(launchpad, alice);
      const { token: tokBContract, tokenAddr: tokB } = await launchToken(launchpad, bob);

      await launchpad.write.buy([tokA, 0n], { value: parseEther("2"), account: bob.account });
      await launchpad.write.buy([tokB, 0n], { value: parseEther("3"), account: carol.account });
      await launchpad.write.buy([tokA, 0n], { value: parseEther("0.5"), account: carol.account });

      // partial sell on A by carol
      const carolA: bigint = await tokAContract.read.balanceOf([getAddress(carol.account.address)]);
      await tokAContract.write.approve([getAddress(launchpad.address), carolA], { account: carol.account });
      await launchpad.write.sell([tokA, carolA, 0n], { account: carol.account });

      // partial sell on B by carol
      const carolB: bigint = await tokBContract.read.balanceOf([getAddress(carol.account.address)]);
      await tokBContract.write.approve([getAddress(launchpad.address), carolB / 2n], { account: carol.account });
      await launchpad.write.sell([tokB, carolB / 2n, 0n], { account: carol.account });

      await checkBackingInvariant(launchpad, [tokA, tokB], publicClient);
    });
  });

  // -------------------------------------------------------------------------
  describe("graduation by owner", () => {
    it("owner can force-graduate early; leftover supply is burned", async () => {
      const { launchpad, alice, bob, deployer, publicClient } = await loadFixture(baseFixture);
      const { token, tokenAddr } = await launchToken(launchpad, alice);
      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("1"), account: bob.account });
      const sold: bigint = await launchpad.read.tokensSoldOf([tokenAddr]);
      const lpSupply: bigint = await launchpad.read.lpSupplyOf([tokenAddr]);
      await expect(launchpad.write.graduateByOwner([tokenAddr, 0n, 0n], { account: bob.account })).to.be.rejected; // not owner
      await launchpad.write.graduateByOwner([tokenAddr, 0n, 0n], { account: deployer.account });
      expect(await launchpad.read.isGraduated([tokenAddr])).to.equal(true);
      expect(await token.read.balanceOf([getAddress(launchpad.address)])).to.equal(0n);
      const pairAddr = (await launchpad.read.pairOf([tokenAddr])) as Address;
      expect(await token.read.balanceOf([pairAddr])).to.equal(lpSupply);
      const burnedExpected = DEFAULTS.totalSupply - sold - lpSupply;
      gt(burnedExpected, 0n);
      expect(await token.read.totalSupply()).to.equal(DEFAULTS.totalSupply - burnedExpected);
      await checkBackingInvariant(launchpad, [tokenAddr], publicClient);
    });
  });

  // -------------------------------------------------------------------------
  describe("fees", () => {
    it("creator claims their fees; protocol fees withdrawn by the owner", async () => {
      const { launchpad, alice, bob, carol, deployer, publicClient } = await loadFixture(baseFixture);
      const { token, tokenAddr } = await launchToken(launchpad, alice);
      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("3"), account: bob.account });
      const b: bigint = await token.read.balanceOf([getAddress(bob.account.address)]);
      await token.write.approve([getAddress(launchpad.address), b / 2n], { account: bob.account });
      await launchpad.write.sell([tokenAddr, b / 2n, 0n], { account: bob.account });

      const creatorFees: bigint = await launchpad.read.creatorFeesOf([tokenAddr]);
      const protocolFees: bigint = await launchpad.read.protocolFees();
      gt(creatorFees, 0n);
      gt(protocolFees, 0n);

      await expect(launchpad.write.claimCreatorFees([tokenAddr, getAddress(carol.account.address)], { account: bob.account }))
        .to.be.rejected; // not the creator
      const carolBefore = await bal(publicClient, getAddress(carol.account.address));
      await launchpad.write.claimCreatorFees([tokenAddr, getAddress(carol.account.address)], { account: alice.account });
      expect((await bal(publicClient, getAddress(carol.account.address))) - carolBefore).to.equal(creatorFees);
      expect(await launchpad.read.creatorFeesOf([tokenAddr])).to.equal(0n);
      await expect(
        launchpad.write.claimCreatorFees([tokenAddr, getAddress(carol.account.address)], { account: alice.account })
      ).to.be.rejected; // nothing left

      await expect(launchpad.write.withdrawProtocolFees({ account: bob.account })).to.be.rejected; // not owner
      // the sweep always goes to the treasury — no caller-chosen destination
      await launchpad.write.setTreasury([getAddress(carol.account.address)]);
      const treBefore = await bal(publicClient, getAddress(carol.account.address));
      await launchpad.write.withdrawProtocolFees({ account: deployer.account });
      expect((await bal(publicClient, getAddress(carol.account.address))) - treBefore).to.equal(protocolFees);

      await checkBackingInvariant(launchpad, [tokenAddr], publicClient);
    });

    it("sends the creation fee straight to the treasury", async () => {
      // carol's address is needed to build the fixture, so read it up front
      const treasuryAddr = getAddress((await hre.viem.getWalletClients())[3]!.account.address);
      const { launchpad, alice, publicClient } = await loadFixture(
        makeFixture({ treasury: treasuryAddr })
      );
      const before = await bal(publicClient, treasuryAddr);
      await launchToken(launchpad, alice);
      expect((await bal(publicClient, treasuryAddr)) - before).to.equal(DEFAULTS.creationFee);
      expect(await launchpad.read.accruedCreationFees()).to.equal(0n); // nothing left to pull
    });

    it("graduation sweeps every protocol fee to the treasury, leaving only creator fees", async () => {
      const treasuryAddr = getAddress((await hre.viem.getWalletClients())[3]!.account.address);
      const { launchpad, tokenAddr, bob, publicClient } = await loadFixture(
        launchedFixtureFor({ treasury: treasuryAddr })
      );
      // accrue some per-trade protocol fees first, so the sweep has more than
      // just the graduation cut to move
      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("2"), account: bob.account });
      gt(await launchpad.read.protocolFees(), 0n);

      const before = await bal(publicClient, treasuryAddr);
      const owedBefore: bigint =
        (await launchpad.read.protocolFees()) + (await launchpad.read.accruedCreationFees());

      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("40"), account: bob.account });
      expect(await launchpad.read.isGraduated([tokenAddr])).to.equal(true);

      const raised: bigint = await launchpad.read.realEthRaisedOf([tokenAddr]);
      const gradFee = (raised * BigInt(DEFAULTS.graduationFeeBps)) / 10_000n;
      const gradProtocolCut = gradFee - (gradFee * BigInt(DEFAULTS.gradCreatorShareBps)) / 10_000n;

      // treasury received the pre-existing pot plus at least the graduation cut
      const received = (await bal(publicClient, treasuryAddr)) - before;
      gte(received, owedBefore + gradProtocolCut);

      // nothing owed to the protocol is left behind — no manual withdrawal needed
      expect(await launchpad.read.protocolFees()).to.equal(0n);
      expect(await launchpad.read.accruedCreationFees()).to.equal(0n);

      // and the launchpad now holds exactly the creator's unclaimed fees, nothing more
      const creatorFees: bigint = await launchpad.read.creatorFeesOf([tokenAddr]);
      expect(await bal(publicClient, getAddress(launchpad.address))).to.equal(creatorFees);
    });

    it("a reverting treasury never bricks createToken; the fee falls back to the pull balance", async () => {
      const reverter = await hre.viem.deployContract("RevertingReceiver", []);
      const { launchpad, alice, deployer } = await loadFixture(
        makeFixture({ treasury: getAddress(reverter.address) })
      );
      await launchToken(launchpad, alice); // succeeds — push failed, fee accrued instead
      expect(await launchpad.read.accruedCreationFees()).to.equal(DEFAULTS.creationFee);
      await expect(launchpad.write.withdrawCreationFees()).to.be.rejected; // sweep to the reverter fails
      await launchpad.write.setTreasury([getAddress(deployer.account.address)]); // rotate, then retry
      await launchpad.write.withdrawCreationFees();
      expect(await launchpad.read.accruedCreationFees()).to.equal(0n);
    });

    it("pays a contract treasury that emits on receive (the DAO Treasury shape)", async () => {
      const treasuryC = await hre.viem.deployContract("EventEmittingTreasury", []);
      const { launchpad, alice, publicClient } = await loadFixture(
        makeFixture({ treasury: getAddress(treasuryC.address) })
      );
      await launchToken(launchpad, alice);
      // delivered, not escrowed to the pull balance
      expect(await treasuryC.read.totalReceived()).to.equal(DEFAULTS.creationFee);
      expect(await bal(publicClient, getAddress(treasuryC.address))).to.equal(DEFAULTS.creationFee);
      expect(await launchpad.read.accruedCreationFees()).to.equal(0n);
    });

    it("a gas-griefing treasury cannot brick a launch", async () => {
      const griefer = await hre.viem.deployContract("GasGriefingTreasury", []);
      const { launchpad, alice } = await loadFixture(
        makeFixture({ treasury: getAddress(griefer.address) })
      );
      await launchToken(launchpad, alice); // survives: the push is gas-capped, failure falls back
      expect(await launchpad.read.accruedCreationFees()).to.equal(DEFAULTS.creationFee);
    });

    it("a reverting treasury never bricks graduation", async () => {
      const reverter = await hre.viem.deployContract("RevertingReceiver", []);
      const { launchpad, tokenAddr, bob } = await loadFixture(
        launchedFixtureFor({ treasury: getAddress(reverter.address) })
      );
      const pfBefore: bigint = await launchpad.read.protocolFees();
      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("40"), account: bob.account });
      expect(await launchpad.read.isGraduated([tokenAddr])).to.equal(true);
      gt(await launchpad.read.protocolFees(), pfBefore); // graduation fee fell back to pull
    });
  });

  // -------------------------------------------------------------------------
  describe("pause", () => {
    it("blocks createToken and buy while paused, never sell", async () => {
      const { launchpad, alice, bob } = await loadFixture(baseFixture);
      const { token, tokenAddr } = await launchToken(launchpad, alice);
      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("1"), account: bob.account });
      await launchpad.write.pause();
      await expect(launchpad.write.createToken(["X", "X", ""], { value: DEFAULTS.creationFee, account: alice.account }))
        .to.be.rejected;
      await expect(launchpad.write.buy([tokenAddr, 0n], { value: parseEther("1"), account: bob.account })).to.be
        .rejected;
      const b: bigint = await token.read.balanceOf([getAddress(bob.account.address)]);
      await token.write.approve([getAddress(launchpad.address), b], { account: bob.account });
      await launchpad.write.sell([tokenAddr, b, 0n], { account: bob.account }); // sell still works
      await launchpad.write.unpause();
      await launchpad.write.buy([tokenAddr, 0n], { value: parseEther("1"), account: bob.account }); // ok again
    });
  });

  // -------------------------------------------------------------------------
  describe("UUPS upgrade", () => {
    it("only the owner can upgrade; state is preserved", async () => {
      const { launchpad, alice } = await loadFixture(baseFixture);
      const v2 = await hre.viem.deployContract("LaunchpadV2", []);
      await expect(launchpad.write.upgradeToAndCall([getAddress(v2.address), "0x"], { account: alice.account })).to.be
        .rejected;
      const feeBefore: bigint = await launchpad.read.creationFee();
      await launchpad.write.upgradeToAndCall([getAddress(v2.address), "0x"]);
      const upgraded = await hre.viem.getContractAt("LaunchpadV2", launchpad.address);
      expect(await upgraded.read.version()).to.equal(2n);
      expect(await upgraded.read.creationFee()).to.equal(feeBefore);
      await launchToken(upgraded, alice);
      expect(await upgraded.read.totalTokens()).to.equal(1n);
    });
  });
});
