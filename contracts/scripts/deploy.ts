/**
 * Deploys the launchpad:
 *   1. Launchpad implementation (single monolithic contract; trading + graduation live here)
 *   2. ERC1967 (UUPS) proxy in front of it, initialised with the curve params
 *
 * Env (all optional):
 *   DEX_ROUTER   Uniswap-V2-compatible router address. If unset, mock Uniswap V2 is
 *                deployed (useful on a fresh `hardhat node`).
 *   TREASURY     protocol fee recipient. Defaults to the deployer.
 *   FUNDING_GOAL / VIRTUAL_TOKEN_RESERVE / TOTAL_SUPPLY / LP_BPS — curve params; see
 *   scripts/calculateBondingCurve.ts. Defaults: 30 native goal, 1B supply, 20% LP.
 *
 *   npx hardhat run scripts/deploy.ts --network localhost
 */
import { parseEther, type Address } from "viem";
import { deployLaunchpad } from "./deployLaunchpad";

const WAD = 10n ** 18n;

async function main() {
  const dexRouter = process.env.DEX_ROUTER as Address | undefined;
  const treasury = process.env.TREASURY as Address | undefined;

  const { launchpad, launchpadImpl, proxy, dexRouter: usedRouter, mockDex } = await deployLaunchpad({
    dexRouter,
    treasury,
    fundingGoal: process.env.FUNDING_GOAL ? parseEther(process.env.FUNDING_GOAL) : undefined,
    virtualTokenReserve: process.env.VIRTUAL_TOKEN_RESERVE
      ? BigInt(process.env.VIRTUAL_TOKEN_RESERVE) * WAD
      : undefined,
    totalSupply: process.env.TOTAL_SUPPLY ? BigInt(process.env.TOTAL_SUPPLY) * WAD : undefined,
    lpBps: process.env.LP_BPS ? Number(process.env.LP_BPS) : undefined,
  });

  console.log("Launchpad implementation    :", launchpadImpl.address);
  console.log("Launchpad (proxy)           :", proxy.address, "<-- use this");
  console.log("DEX router                  :", usedRouter, mockDex ? "(mock — deployed for this run)" : "");
  console.log("owner                       :", await launchpad.read.owner());
  console.log("treasury                    :", await launchpad.read.treasury());
  console.log("fundingGoal                 :", (await launchpad.read.fundingGoal()).toString());
  console.log("virtualEthReserve (derived) :", (await launchpad.read.virtualEthReserve()).toString());
  console.log("virtualTokenReserve         :", (await launchpad.read.virtualTokenReserve()).toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
