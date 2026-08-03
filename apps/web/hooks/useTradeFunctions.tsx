import { decodeEventLog, parseEther } from "viem";
import { erc20Abi } from "viem";

import { Token } from "@/types";
import { launchpadAbi } from "@lcai/abis";
import { MAX_UINT256 } from "@/lib/utils";
import useUserStore from "@/store/user-store";
import useContracts from "./useContracts";
import useWeb3Clients from "./useWeb3Clients";

export default function useTradeFunctions() {
  const { publicClient, walletClient } = useWeb3Clients();
  const { launchpadContract } = useContracts();
  const { slippageTolerance } = useUserStore();

  /** ETH-in → token-out quote. Returns the net ETH spent and tokens received. */
  const quoteBuy = async (
    token: Pick<Token, "address">,
    ethIn: string,
  ): Promise<{ tokensOut: bigint; ethInNet: bigint; fee: bigint; refund: bigint }> => {
    const [tokensOut, ethInNet, fee, refund] =
      await launchpadContract.read.quoteBuy([token.address, parseEther(ethIn)]);
    return { tokensOut, ethInNet, fee, refund };
  };

  /** token-in → ETH-out quote. */
  const quoteSell = async (
    token: Pick<Token, "address">,
    tokenAmount: string,
  ): Promise<{ ethOutNet: bigint; fee: bigint }> => {
    const [ethOutNet, fee] = await launchpadContract.read.quoteSell([
      token.address,
      parseEther(tokenAmount),
    ]);
    return { ethOutNet, fee };
  };

  /**
   * Create a new token. `metadataURI` is the `ipfs://CID` returned by
   * `POST /v1/metadata`. The launchpad charges a `creationFee` in native; an
   * optional `devBuyEth` is passed in the same tx (extra msg.value beyond the
   * fee is spent on a first buy by the creator).
   */
  const createToken = async (payload: {
    name: string;
    symbol: string;
    metadataURI: string;
    devBuyEth?: string;
  }): Promise<
    | { hash: `0x${string}`; tokenAddress: `0x${string}`; creatorAddress: `0x${string}` }
    | undefined
  > => {
    if (!walletClient) return;

    const creationFee = await launchpadContract.read.creationFee();
    const devBuyWei = payload.devBuyEth ? parseEther(payload.devBuyEth) : 0n;
    const value = creationFee + devBuyWei;

    const { request } = await launchpadContract.simulate.createToken(
      [payload.name, payload.symbol, payload.metadataURI],
      { value, account: walletClient.account.address },
    );

    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: launchpadAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "TokenLaunched") {
          const args = decoded.args as { token: `0x${string}`; creator: `0x${string}` };
          return { hash, tokenAddress: args.token, creatorAddress: args.creator };
        }
      } catch {
        /* not a launchpad event */
      }
    }
    return undefined;
  };

  const applySlippage = (amount: bigint, side: "min" | "max"): bigint => {
    const bps = BigInt(Math.round(slippageTolerance * 100)); // tolerance in % → bps
    return side === "min"
      ? (amount * (10_000n - bps)) / 10_000n
      : (amount * (10_000n + bps)) / 10_000n;
  };

  /**
   * Buy tokens with `ethIn` native. The quote determines a slippage-adjusted
   * `minTokensOut`. Returns the tx hash; throws on simulate / write errors.
   */
  const buyToken = async (token: Token, ethIn: string): Promise<`0x${string}` | undefined> => {
    if (!walletClient) return;
    if (token.graduated) throw new Error("token has graduated; trade on the DEX");

    const { tokensOut } = await quoteBuy(token, ethIn);
    const minTokensOut = applySlippage(tokensOut, "min");

    const { request } = await launchpadContract.simulate.buy(
      [token.address, minTokensOut],
      { value: parseEther(ethIn), account: walletClient.account.address },
    );
    return walletClient.writeContract(request);
  };

  /**
   * Sell `tokenIn` tokens for ETH. We pre-approve the launchpad to spend the
   * tokens (max allowance, one-time), then sell at slippage-adjusted minEthOut.
   */
  const sellToken = async (token: Token, tokenIn: string): Promise<`0x${string}` | undefined> => {
    if (!walletClient) return;
    if (token.graduated) throw new Error("token has graduated; trade on the DEX");

    const tokenAmount = parseEther(tokenIn);
    const allowance = await publicClient.readContract({
      address: token.address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [walletClient.account.address, launchpadContract.address],
    });
    if (allowance < tokenAmount) {
      const approveHash = await walletClient.writeContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [launchpadContract.address, MAX_UINT256],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    const { ethOutNet } = await quoteSell(token, tokenIn);
    const minEthOut = applySlippage(ethOutNet, "min");

    const { request } = await launchpadContract.simulate.sell(
      [token.address, tokenAmount, minEthOut],
      { account: walletClient.account.address },
    );
    return walletClient.writeContract(request);
  };

  return { createToken, buyToken, sellToken, quoteBuy, quoteSell };
}
