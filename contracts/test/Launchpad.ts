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

    it("enforces fee caps & a non-zero treasury", async () => {
      const { launchpad, deployer } = await loadFixture(baseFixture);
      const t = getAddress(deployer.account.address);
      await expect(launchpad.write.setFeeConfig([0n, 1001, 100, 5000, 5000, t])).to.be.rejected; // tradeFee > 10%
      await expect(launchpad.write.setFeeConfig([0n, 100, 2001, 5000, 5000, t])).to.be.rejected; // gradFee > 20%
      await expect(launchpad.write.setFeeConfig([0n, 100, 100, 10001, 5000, t])).to.be.rejected; // creator share > 100%
      await expect(launchpad.write.setFeeConfig([0n, 100, 100, 5000, 5000, zeroAddress])).to.be.rejected; // zero treasury
      await launchpad.write.setFeeConfig([parseEther("0.02"), 200, 150, 4000, 6000, t]);
      expect(await launchpad.read.creationFee()).to.equal(parseEther("0.02"));
      expect(await launchpad.read.tradeFeeBps()).to.equal(200);
    });

    it("gates owner-only functions", async () => {
      const { launchpad, alice } = await loadFixture(baseFixture);
      await expect(launchpad.write.setAntiBot([0n, 0, 0], { account: alice.account })).to.be.rejected;
      await expect(launchpad.write.pause({ account: alice.account })).to.be.rejected;
      await expect(launchpad.write.setDexRouter([zeroAddress], { account: alice.account })).to.be.rejected;
      await expect(
        launchpad.write.withdrawCreationFees([getAddress(alice.account.address)], { account: alice.account })
      ).to.be.rejected;
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

    it("launches a token, mints full supply to the launchpad, records mappings, accrues the fee", async () => {
      const { launchpad, alice } = await loadFixture(baseFixture);
      const { token, tokenAddr } = await launchToken(launchpad, alice);
      expect(await token.read.totalSupply()).to.equal(DEFAULTS.totalSupply);
      expect(await token.read.balanceOf([getAddress(launchpad.address)])).to.equal(DEFAULTS.totalSupply);
      expect(getAddress(await launchpad.read.creatorOf([tokenAddr]))).to.equal(getAddress(alice.account.address));
      expect(await launchpad.read.totalTokens()).to.equal(1n);
      expect(await launchpad.read.accruedCreationFees()).to.equal(DEFAULTS.creationFee);
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
      await expect(launchpad.write.graduateByOwner([tokenAddr], { account: bob.account })).to.be.rejected; // not owner
      await launchpad.write.graduateByOwner([tokenAddr], { account: deployer.account });
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

      await expect(
        launchpad.write.withdrawProtocolFees([getAddress(carol.account.address)], { account: bob.account })
      ).to.be.rejected; // not owner
      const treBefore = await bal(publicClient, getAddress(carol.account.address));
      await launchpad.write.withdrawProtocolFees([getAddress(carol.account.address)], { account: deployer.account });
      expect((await bal(publicClient, getAddress(carol.account.address))) - treBefore).to.equal(protocolFees);

      await checkBackingInvariant(launchpad, [tokenAddr], publicClient);
    });

    it("a reverting treasury never bricks createToken; only the pull withdrawal to it fails", async () => {
      const reverter = await hre.viem.deployContract("RevertingReceiver", []);
      const { launchpad, alice, deployer } = await loadFixture(
        makeFixture({ treasury: getAddress(reverter.address) })
      );
      await launchToken(launchpad, alice); // succeeds — creation fee is accrued, not pushed
      expect(await launchpad.read.accruedCreationFees()).to.equal(DEFAULTS.creationFee);
      await expect(launchpad.write.withdrawCreationFees([getAddress(reverter.address)])).to.be.rejected; // push fails
      await launchpad.write.withdrawCreationFees([getAddress(deployer.account.address)]); // re-pointed: works
      expect(await launchpad.read.accruedCreationFees()).to.equal(0n);
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
