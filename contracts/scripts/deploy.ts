/**
 * Deploys the launchpad:
 *   1. Launchpad implementation (single monolithic contract; trading + graduation live here)
 *   2. ERC1967 (UUPS) proxy in front of it, initialised with the curve params
 *
 * Env (all optional):
 *   DEX_ROUTER   Uniswap-V2-compatible router address. If unset, a real local Uniswap V2 is
 *                deployed (useful on a fresh Anvil / hardhat node).
 *   TREASURY     protocol fee recipient. Defaults to the deployer.
 *   FUNDING_GOAL / VIRTUAL_TOKEN_RESERVE / TOTAL_SUPPLY / LP_BPS — curve params; see
 *   scripts/calculateBondingCurve.ts. Defaults: 30 native goal, 1B supply, 20% LP.
 *   DEPLOYMENT_OUT  Path for the JSON summary (default: deployments/<network>.json).
 *
 *   npx hardhat run scripts/deploy.ts --network localhost
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import hre from "hardhat";
import { parseEther, type Address } from "viem";
import { chainOpts } from "./chain";
import { deployLaunchpad } from "./deployLaunchpad";

const WAD = 10n ** 18n;

async function main() {
  const dexRouter = (process.env.DEX_ROUTER || undefined) as Address | undefined;
  const treasury = (process.env.TREASURY || undefined) as Address | undefined;

  const publicClient = await hre.viem.getPublicClient(chainOpts());
  const startBlockBefore = await publicClient.getBlockNumber();

  const { launchpad, launchpadImpl, proxy, dexRouter: usedRouter, dex } =
    await deployLaunchpad({
      dexRouter,
      treasury,
      fundingGoal: process.env.FUNDING_GOAL
        ? parseEther(process.env.FUNDING_GOAL)
        : undefined,
      virtualTokenReserve: process.env.VIRTUAL_TOKEN_RESERVE
        ? BigInt(process.env.VIRTUAL_TOKEN_RESERVE) * WAD
        : undefined,
      totalSupply: process.env.TOTAL_SUPPLY
        ? BigInt(process.env.TOTAL_SUPPLY) * WAD
        : undefined,
      lpBps: process.env.LP_BPS ? Number(process.env.LP_BPS) : undefined,
    });

  const blockNumber = await publicClient.getBlockNumber();
  const chainId = await publicClient.getChainId();
  const networkName = hre.network.name;

  const deployment = {
    network: networkName,
    chainId,
    // Index from the block before deploy so the TokenLaunched at deploy-time is included.
    startBlock: Number(startBlockBefore),
    deployedAtBlock: Number(blockNumber),
    launchpad: proxy.address,
    launchpadImpl: launchpadImpl.address,
    dexRouter: usedRouter,
    weth: dex?.weth.address ?? null,
    uniswapV2Factory: dex?.factory.address ?? null,
    localDex: Boolean(dex),
    owner: await launchpad.read.owner(),
    treasury: await launchpad.read.treasury(),
  };

  const outPath =
    process.env.DEPLOYMENT_OUT ??
    join(__dirname, "..", "deployments", `${networkName}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(deployment, null, 2)}\n`);

  console.log("Launchpad implementation    :", launchpadImpl.address);
  console.log("Launchpad (proxy)           :", proxy.address, "<-- use this");
  console.log(
    "DEX router                  :",
    usedRouter,
    dex ? "(deployed locally for this run)" : "",
  );
  if (dex) {
    console.log("WETH                        :", dex.weth.address);
    console.log("Uniswap V2 factory          :", dex.factory.address);
  }
  console.log("owner                       :", deployment.owner);
  console.log("treasury                    :", deployment.treasury);
  console.log("chainId                     :", chainId);
  console.log("startBlock                  :", deployment.startBlock);
  console.log("fundingGoal                 :", (await launchpad.read.fundingGoal()).toString());
  console.log(
    "virtualEthReserve (derived) :",
    (await launchpad.read.virtualEthReserve()).toString(),
  );
  console.log(
    "virtualTokenReserve         :",
    (await launchpad.read.virtualTokenReserve()).toString(),
  );
  console.log("Wrote deployment summary    :", outPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
