/**
 * Live-network smoke test: exercises an ALREADY-DEPLOYED launchpad end to end.
 *
 * The mocha suite in test/ cannot run against a real chain — it is built on
 * `loadFixture`, i.e. evm_snapshot/evm_revert, which no live node implements.
 * This is the live-chain counterpart: no fixtures, no snapshots, real gas.
 *
 *   LAUNCHPAD_ADDRESS=0x… npx hardhat run scripts/smoke.ts --network lcaiTestnet
 *
 * Address falls back to deployments/<network>.json. Tunables:
 *   SMOKE_DEV_BUY  native spent on the launch dev-buy (default 0.05)
 *   SMOKE_BUY      native spent on the follow-up buy  (default 0.02)
 *   SMOKE_SLIPPAGE bps of slippage tolerance          (default 100 = 1%)
 *
 * Costs real testnet gas plus `creationFee`, and leaves a junk token on-chain.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import hre from "hardhat";
import { formatEther, parseEther, parseEventLogs, type Address } from "viem";

import { chainOpts } from "./chain";

const DEV_BUY = parseEther(process.env.SMOKE_DEV_BUY ?? "0.05");
const BUY = parseEther(process.env.SMOKE_BUY ?? "0.02");
const SLIPPAGE_BPS = BigInt(process.env.SMOKE_SLIPPAGE ?? "100");

/**
 * LCAI testnet's `eth_estimateGas` under-estimates, and viem sends the estimate
 * verbatim. A `buy` sent with the node's 88,533 estimate reverted out-of-gas at
 * 87,597 while the identical call replayed against the same block state fine —
 * and the node then quoted 91,255 for it. Pad every write.
 */
const GAS_BUFFER_PCT = BigInt(process.env.SMOKE_GAS_BUFFER ?? "40");

const minOut = (quoted: bigint) => (quoted * (10_000n - SLIPPAGE_BPS)) / 10_000n;

function launchpadAddress(): Address {
  if (process.env.LAUNCHPAD_ADDRESS) return process.env.LAUNCHPAD_ADDRESS as Address;
  const file = join(__dirname, "..", "deployments", `${hre.network.name}.json`);
  if (!existsSync(file)) {
    throw new Error(`Set LAUNCHPAD_ADDRESS, or deploy first to create ${file}`);
  }
  return JSON.parse(readFileSync(file, "utf8")).launchpad as Address;
}

async function main() {
  const opts = chainOpts();
  const publicClient = await hre.viem.getPublicClient(opts);
  const [wallet] = await hre.viem.getWalletClients(opts);
  const client = { public: publicClient, wallet };
  const me = wallet.account.address;

  const launchpad = await hre.viem.getContractAt("Launchpad", launchpadAddress(), { client });

  /** Gas limit for a write: the node's estimate, padded. */
  const gasFor = async (
    to: { address: Address; abi: readonly unknown[] },
    functionName: string,
    args: readonly unknown[],
    value?: bigint,
  ) => {
    const estimate = await publicClient.estimateContractGas({
      address: to.address,
      abi: to.abi,
      functionName,
      args,
      account: wallet.account,
      ...(value === undefined ? {} : { value }),
    } as Parameters<typeof publicClient.estimateContractGas>[0]);
    return (estimate * (100n + GAS_BUFFER_PCT)) / 100n;
  };

  /** Waits for a write and fails loudly on revert — a receipt is NOT a success. */
  const wait = async (label: string, hash: `0x${string}`) => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(
      receipt.status,
      "success",
      `${label} reverted (gas used ${receipt.gasUsed}) — tx ${receipt.transactionHash}`,
    );
    return receipt;
  };

  const [creationFee, fundingGoal, paused] = await Promise.all([
    launchpad.read.creationFee(),
    launchpad.read.fundingGoal(),
    launchpad.read.paused(),
  ]);
  assert.equal(paused, false, "launchpad is paused — nothing to smoke-test");

  const balance = await publicClient.getBalance({ address: me });
  const needed = creationFee + DEV_BUY + BUY;
  assert.ok(
    balance > needed,
    `deployer ${me} holds ${formatEther(balance)} but the run needs > ${formatEther(needed)} plus gas`,
  );

  console.log("launchpad   :", launchpad.address);
  console.log("signer      :", me, `(${formatEther(balance)} LCAI)`);
  console.log("creationFee :", formatEther(creationFee), " fundingGoal:", formatEther(fundingGoal));

  // ---- 1. create a token, with the surplus over creationFee as the dev-buy ----
  const symbol = `SMOKE${String(await publicClient.getBlockNumber()).slice(-4)}`;
  const createArgs = [`Smoke ${symbol}`, symbol, "ipfs://smoke"] as const;
  const receipt = await wait(
    "createToken",
    await launchpad.write.createToken(createArgs, {
      value: creationFee + DEV_BUY,
      gas: await gasFor(launchpad, "createToken", createArgs, creationFee + DEV_BUY),
    }),
  );
  const [launched] = parseEventLogs({
    abi: launchpad.abi,
    eventName: "TokenLaunched",
    logs: receipt.logs,
  });
  assert.ok(launched, "createToken emitted no TokenLaunched");
  const tokenAddr = launched.args.token;
  const token = await hre.viem.getContractAt("Token", tokenAddr, { client });

  const afterDevBuy = await token.read.balanceOf([me]);
  assert.ok(afterDevBuy > 0n, "dev-buy credited no tokens");
  console.log(`created     : ${tokenAddr}  dev-buy → ${formatEther(afterDevBuy)} ${symbol}`);

  // ---- 2. buy on the curve, honouring the quote ----
  const [quotedTokens, , buyFee, refund] = await launchpad.read.quoteBuy([tokenAddr, BUY]);
  const buyArgs = [tokenAddr, minOut(quotedTokens)] as const;
  await wait(
    "buy",
    await launchpad.write.buy(buyArgs, {
      value: BUY,
      gas: await gasFor(launchpad, "buy", buyArgs, BUY),
    }),
  );

  const afterBuy = await token.read.balanceOf([me]);
  const bought = afterBuy - afterDevBuy;
  assert.ok(
    bought >= minOut(quotedTokens),
    `buy delivered ${formatEther(bought)} < quoted floor ${formatEther(minOut(quotedTokens))}`,
  );
  console.log(
    `buy         : ${formatEther(BUY)} LCAI → ${formatEther(bought)} ${symbol}` +
      `  (fee ${formatEther(buyFee)}, refund ${formatEther(refund)})`,
  );

  // ---- 3. sell it all back ----
  const [quotedEth, sellFee] = await launchpad.read.quoteSell([tokenAddr, afterBuy]);
  const approveArgs = [launchpad.address, afterBuy] as const;
  await wait(
    "approve",
    await token.write.approve(approveArgs, {
      gas: await gasFor(token, "approve", approveArgs),
    }),
  );
  const sellArgs = [tokenAddr, afterBuy, minOut(quotedEth)] as const;
  await wait(
    "sell",
    await launchpad.write.sell(sellArgs, { gas: await gasFor(launchpad, "sell", sellArgs) }),
  );

  const remaining = await token.read.balanceOf([me]);
  assert.equal(remaining, 0n, `sell left ${formatEther(remaining)} ${symbol} behind`);
  console.log(
    `sell        : ${formatEther(afterBuy)} ${symbol} → ~${formatEther(quotedEth)} LCAI` +
      ` (fee ${formatEther(sellFee)})`,
  );

  console.log("\ncreate / dev-buy / quote / buy / approve / sell all OK on", hre.network.name);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
