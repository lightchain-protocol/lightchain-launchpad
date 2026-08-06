import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "chai";
import hre from "hardhat";
import { getAddress, keccak256, parseEther, type Address, type Hex } from "viem";

import { deployDex } from "../scripts/deployLaunchpad";

/**
 * `UniswapV2Library.pairFor` derives pair addresses with CREATE2 against a
 * hardcoded init code hash instead of asking the factory. The canonical
 * `96e8ac42…` is the hash of Uniswap's own 0.5.16 build; solc metadata differs
 * here, so `contracts/uniswap/UniswapV2Library.sol` carries the hash of the
 * `UniswapV2Pair` THIS repo compiles.
 *
 * That makes the constant a build-time dependency: change the solc version,
 * the optimizer settings, or the Pair source, and every address the router
 * derives silently points at nothing. These two cases make that impossible to
 * miss.
 */
describe("Uniswap V2 init code hash", () => {
  const LIBRARY_PATH = join(__dirname, "..", "contracts", "uniswap", "UniswapV2Library.sol");
  const PAIR_ARTIFACT = join(
    __dirname,
    "..",
    "artifacts",
    "@uniswap",
    "v2-core",
    "contracts",
    "UniswapV2Pair.sol",
    "UniswapV2Pair.json",
  );

  it("matches the compiled UniswapV2Pair creation bytecode", async () => {
    const source = readFileSync(LIBRARY_PATH, "utf8");
    const m = /hex'([0-9a-f]{64})' \/\/ init code hash/.exec(source);
    expect(m, "could not find the init code hash literal in UniswapV2Library.sol").to.not.equal(null);
    const hardcoded = m![1]!;

    const artifact = JSON.parse(readFileSync(PAIR_ARTIFACT, "utf8")) as { bytecode: Hex };
    const compiled = keccak256(artifact.bytecode).slice(2);

    expect(
      hardcoded,
      `UniswapV2Library.pairFor's init code hash is stale.\n` +
        `  hardcoded: ${hardcoded}\n` +
        `  compiled : ${compiled}\n` +
        `Update the hex literal in contracts/uniswap/UniswapV2Library.sol.`,
    ).to.equal(compiled);
  });

  it("derives the address the factory actually created", async () => {
    const [deployer] = await hre.viem.getWalletClients();
    const dex = await deployDex();

    const token = await hre.viem.deployContract("Token", [
      "Probe",
      "PRB",
      parseEther("1000"),
      getAddress(deployer.account.address),
    ]);
    const weth = getAddress(dex.weth.address);
    const tokenAddr = getAddress(token.address);

    await dex.factory.write.createPair([tokenAddr, weth]);
    const fromFactory = getAddress(
      (await dex.factory.read.getPair([tokenAddr, weth])) as Address,
    );

    // Seed it through the router. Every router entry point routes through
    // `pairFor`, so if the hash were wrong this would touch an address with no
    // code and revert instead of minting.
    await token.write.approve([getAddress(dex.router.address), parseEther("1000")]);
    await dex.router.write.addLiquidityETH(
      [
        tokenAddr,
        parseEther("1000"),
        0n,
        0n,
        getAddress(deployer.account.address),
        BigInt(Math.floor(Date.now() / 1000) + 3600),
      ],
      { value: parseEther("1") },
    );

    expect(await token.read.balanceOf([fromFactory])).to.equal(parseEther("1000"));
    expect(await dex.weth.read.balanceOf([fromFactory])).to.equal(parseEther("1"));
  });
});
