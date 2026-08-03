/**
 * Bonding-curve parameter helper.
 *
 * Given a funding goal (the native amount that graduates a token) and a chosen virtual
 * token reserve, this prints the wei-scale tuple to pass to LaunchpadFactory.setCurveParams
 * / the deploy initializer, and verifies the consistency invariant the contract enforces:
 *
 *   maxSupplyForSale     = totalSupply * (1 - lpBps/1e4)
 *   virtualEthReserve    = ceil(fundingGoal * (virtualTokenReserve - maxSupplyForSale) / maxSupplyForSale)
 *   raisedAt(maxSupply)  = virtualEthReserve * maxSupplyForSale / (virtualTokenReserve - maxSupplyForSale)   // must be >= fundingGoal
 *
 * Env (all optional):
 *   FUNDING_GOAL            funding goal in native units            (default "30")
 *   VIRTUAL_TOKEN_RESERVE   virtual token reserve in token units    (default "1073000000")
 *   TOTAL_SUPPLY            total token supply in token units       (default "1000000000")
 *   LP_BPS                  bps reserved for the LP                 (default "2000" = 20%)
 *
 *   npx hardhat run scripts/calculateBondingCurve.ts
 */
import { parseEther, formatEther } from "viem";

const WAD = 10n ** 18n;
const BPS = 10_000n;

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

function main() {
  const fundingGoal = parseEther(process.env.FUNDING_GOAL ?? "10");
  const virtualTokenReserve = BigInt(process.env.VIRTUAL_TOKEN_RESERVE ?? "1073000000") * WAD;
  const totalSupply = BigInt(process.env.TOTAL_SUPPLY ?? "1000000000") * WAD;
  const lpBps = BigInt(process.env.LP_BPS ?? "2000");

  const lpSupply = (totalSupply * lpBps) / BPS;
  const maxSupplyForSale = totalSupply - lpSupply;

  if (lpBps < 100n || lpBps > 5000n) throw new Error("LP_BPS out of [100, 5000]");
  if (virtualTokenReserve < maxSupplyForSale + maxSupplyForSale / 100n) {
    throw new Error("VIRTUAL_TOKEN_RESERVE must be >= 1.01x maxSupplyForSale");
  }

  const virtualEthReserve = ceilDiv(fundingGoal * (virtualTokenReserve - maxSupplyForSale), maxSupplyForSale);
  const raisedAtCap = (virtualEthReserve * maxSupplyForSale) / (virtualTokenReserve - maxSupplyForSale);
  if (raisedAtCap < fundingGoal) throw new Error("inconsistent: raisedAt(maxSupplyForSale) < fundingGoal");

  const initialPriceX18 = (virtualEthReserve * WAD) / virtualTokenReserve;
  const initialMarketCap = (virtualEthReserve * totalSupply) / virtualTokenReserve;

  console.log("=== LaunchpadFactory curve parameters ===");
  console.log("totalSupply           :", totalSupply.toString(), `(${formatEther(totalSupply)} tokens)`);
  console.log("lpBps                 :", lpBps.toString(), `(${Number(lpBps) / 100}%)`);
  console.log("maxSupplyForSale      :", maxSupplyForSale.toString(), `(${formatEther(maxSupplyForSale)} tokens)`);
  console.log("lpSupply              :", lpSupply.toString(), `(${formatEther(lpSupply)} tokens)`);
  console.log("fundingGoal           :", fundingGoal.toString(), `(${formatEther(fundingGoal)} native)`);
  console.log("virtualTokenReserve   :", virtualTokenReserve.toString());
  console.log("virtualEthReserve     :", virtualEthReserve.toString(), `(~${formatEther(virtualEthReserve)} native)`);
  console.log("--- derived / sanity ---");
  console.log(
    "raisedAt(maxSupply)   :",
    raisedAtCap.toString(),
    `(~${formatEther(raisedAtCap)} native, >= fundingGoal: ${raisedAtCap >= fundingGoal})`
  );
  console.log("initial price (x1e18) :", initialPriceX18.toString());
  console.log("initial market cap    :", `~${formatEther(initialMarketCap)} native`);
  console.log("\nPass to setCurveParams(totalSupply, lpBps, fundingGoal, virtualTokenReserve):");
  console.log(`  ${totalSupply}, ${lpBps}, ${fundingGoal}, ${virtualTokenReserve}`);
}

main();
