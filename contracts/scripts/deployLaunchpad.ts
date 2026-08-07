import hre from "hardhat";
import { encodeFunctionData, getAddress, parseEther, type Address } from "viem";

import { chainOpts } from "./chain";

const WAD = 10n ** 18n;

export const DEFAULTS = {
  creationFee: parseEther("0.01"),
  tradeFeeBps: 100, // 1%
  graduationFeeBps: 100, // 1%
  creatorFeeShareBps: 5000, // 50% of each trade fee to the creator
  gradCreatorShareBps: 5000, // 50% of the graduation fee to the creator
  totalSupply: 1_000_000_000n * WAD,
  lpBps: 2000, // 20% reserved for the LP
  fundingGoal: parseEther("30"),
  virtualTokenReserve: 1_073_000_000n * WAD,
  maxBuyPerTx: 0n, // disabled
  maxWalletBps: 0, // disabled
  tradeCooldown: 0, // disabled
};

export interface DeployOpts {
  owner?: Address;
  treasury?: Address;
  dexRouter?: Address; // if omitted, a real local Uniswap V2 stack is deployed
  creationFee?: bigint;
  tradeFeeBps?: number;
  graduationFeeBps?: number;
  creatorFeeShareBps?: number;
  gradCreatorShareBps?: number;
  totalSupply?: bigint;
  lpBps?: number;
  fundingGoal?: bigint;
  virtualTokenReserve?: bigint;
  maxBuyPerTx?: bigint;
  maxWalletBps?: number;
  tradeCooldown?: number;
}

/**
 * Deploys the real Uniswap V2 stack — canonical WETH9, UniswapV2Factory and
 * UniswapV2Router02, not mocks. `UniswapV2Library.pairFor` derives pair
 * addresses with CREATE2 against a hardcoded init code hash, so the router in
 * `contracts/uniswap/` carries the hash of the `UniswapV2Pair` this repo
 * compiles (see the note in that file; a test asserts the two stay in sync).
 *
 * The deployer is used as `feeToSetter`; `feeTo` is left unset, which is the
 * mainnet default (the 1/6 protocol fee is off).
 */
export async function deployDex() {
  const opts = chainOpts();
  const publicClient = await hre.viem.getPublicClient(opts);
  const [deployer] = await hre.viem.getWalletClients(opts);
  const client = { public: publicClient, wallet: deployer };

  const weth = await hre.viem.deployContract("WETH9", [], { client });
  const factory = await hre.viem.deployContract("UniswapV2Factory", [
    getAddress(deployer.account.address),
  ], { client });
  const router = await hre.viem.deployContract("UniswapV2Router02", [
    getAddress(factory.address),
    getAddress(weth.address),
  ], { client });
  return { weth, factory, router };
}

/**
 * Deploys the monolithic launchpad:
 *   1. Launchpad implementation
 *   2. ERC1967 (UUPS) proxy in front of it, initialised with the config
 *
 * The returned `launchpad` is the proxy wrapped in the Launchpad ABI — use it for
 * every interaction. The implementation itself is only useful for verification.
 */
export async function deployLaunchpad(opts: DeployOpts = {}) {
  const chain = chainOpts();
  const publicClient = await hre.viem.getPublicClient(chain);
  const [deployer] = await hre.viem.getWalletClients(chain);
  const client = { public: publicClient, wallet: deployer };

  const owner = opts.owner ?? getAddress(deployer.account.address);
  const treasury = opts.treasury ?? owner;

  let dexRouter = opts.dexRouter;
  let dex: Awaited<ReturnType<typeof deployDex>> | undefined;
  if (!dexRouter) {
    dex = await deployDex();
    dexRouter = getAddress(dex.router.address);
  }

  const launchpadImpl = await hre.viem.deployContract("Launchpad", [], {
    client,
  });

  const initArgs = {
    owner,
    treasury,
    dexRouter,
    creationFee: opts.creationFee ?? DEFAULTS.creationFee,
    tradeFeeBps: opts.tradeFeeBps ?? DEFAULTS.tradeFeeBps,
    graduationFeeBps: opts.graduationFeeBps ?? DEFAULTS.graduationFeeBps,
    creatorFeeShareBps: opts.creatorFeeShareBps ?? DEFAULTS.creatorFeeShareBps,
    gradCreatorShareBps: opts.gradCreatorShareBps ?? DEFAULTS.gradCreatorShareBps,
    totalSupply: opts.totalSupply ?? DEFAULTS.totalSupply,
    lpBps: opts.lpBps ?? DEFAULTS.lpBps,
    fundingGoal: opts.fundingGoal ?? DEFAULTS.fundingGoal,
    virtualTokenReserve: opts.virtualTokenReserve ?? DEFAULTS.virtualTokenReserve,
    maxBuyPerTx: opts.maxBuyPerTx ?? DEFAULTS.maxBuyPerTx,
    maxWalletBps: opts.maxWalletBps ?? DEFAULTS.maxWalletBps,
    tradeCooldown: opts.tradeCooldown ?? DEFAULTS.tradeCooldown,
  };

  const initData = encodeFunctionData({
    abi: launchpadImpl.abi,
    functionName: "initialize",
    args: [initArgs],
  });

  const proxy = await hre.viem.deployContract("ERC1967Proxy", [getAddress(launchpadImpl.address), initData], {
    client,
  });
  const launchpad = await hre.viem.getContractAt("Launchpad", proxy.address, {
    client,
  });

  return { launchpad, launchpadImpl, proxy, dexRouter, dex, initArgs };
}
