import { parseEther } from "viem";
import { erc20Abi } from "viem";

import { Token } from "@/types";
import { MAX_UINT256 } from "@/lib/utils";
import useUserStore from "@/store/user-store";
import useWeb3Clients from "./useWeb3Clients";
import useCurrentChain from "./useCurrentChain";
import config from "@/config";
import useContracts from "./useContracts";

const MINUTE = 60;

function applySlippage(amount: bigint, side: "min" | "max", slippageTolerance: number): bigint {
  const bps = BigInt(Math.round(slippageTolerance * 100));
  return side === "min"
    ? (amount * (10_000n - bps)) / 10_000n
    : (amount * (10_000n + bps)) / 10_000n;
}

export default function useDexSwapFunctions() {
  const chain = useCurrentChain();
  const { publicClient, walletClient } = useWeb3Clients();
  const { uniswapV2RouterContract } = useContracts();
  const { slippageTolerance, txDeadline } = useUserStore();

  const wethAddress = config.weth[chain.id];

  const quoteDexBuy = async (
    token: Pick<Token, "address">,
    ethIn: string,
  ): Promise<{ tokensOut: bigint }> => {
    if (!wethAddress) throw new Error("WETH unavailable");
    const amounts = await uniswapV2RouterContract.read.getAmountsOut([
      parseEther(ethIn),
      [wethAddress, token.address],
    ]);
    return { tokensOut: amounts[amounts.length - 1]! };
  };

  /** Exact token-out → ETH-in quote via router getAmountsIn. */
  const quoteDexBuyForTokens = async (
    token: Pick<Token, "address">,
    tokensOut: string,
  ): Promise<{ ethIn: bigint; tokensOut: bigint }> => {
    if (!wethAddress) throw new Error("WETH unavailable");
    const desired = parseEther(tokensOut);
    const amounts = await uniswapV2RouterContract.read.getAmountsIn([
      desired,
      [wethAddress, token.address],
    ]);
    return { ethIn: amounts[0]!, tokensOut: desired };
  };

  const quoteDexSell = async (
    token: Pick<Token, "address">,
    tokenAmount: string,
  ): Promise<{ ethOut: bigint }> => {
    if (!wethAddress) throw new Error("WETH unavailable");
    const amounts = await uniswapV2RouterContract.read.getAmountsOut([
      parseEther(tokenAmount),
      [token.address, wethAddress],
    ]);
    return { ethOut: amounts[amounts.length - 1]! };
  };

  const dexBuyToken = async (token: Token, ethIn: string): Promise<`0x${string}` | undefined> => {
    if (!walletClient || !wethAddress || !publicClient) return;

    const { tokensOut } = await quoteDexBuy(token, ethIn);
    const minOut = applySlippage(tokensOut, "min", slippageTolerance);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + (txDeadline * MINUTE));

    const { request } = await uniswapV2RouterContract.simulate.swapExactETHForTokens(
      [minOut, [wethAddress, token.address], walletClient.account.address, deadline],
      { value: parseEther(ethIn), account: walletClient.account.address },
    );
    const hash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  };

  /** Buy an exact token amount; unused ETH is refunded by the router. */
  const dexBuyTokenForTokens = async (
    token: Token,
    tokensOut: string,
  ): Promise<`0x${string}` | undefined> => {
    if (!walletClient || !wethAddress || !publicClient) return;

    const { ethIn, tokensOut: desired } = await quoteDexBuyForTokens(token, tokensOut);
    const maxEthIn = applySlippage(ethIn, "max", slippageTolerance);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + (txDeadline * MINUTE));

    const { request } = await uniswapV2RouterContract.simulate.swapETHForExactTokens(
      [desired, [wethAddress, token.address], walletClient.account.address, deadline],
      { value: maxEthIn, account: walletClient.account.address },
    );
    const hash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  };

  const dexSellToken = async (token: Token, tokenIn: string): Promise<`0x${string}` | undefined> => {
    if (!walletClient || !wethAddress || !publicClient) return;

    const amount = parseEther(tokenIn);

    const allowance = await publicClient.readContract({
      address: token.address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [walletClient.account.address, uniswapV2RouterContract.address],
    });
    if (allowance < amount) {
      const approveHash = await walletClient.writeContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [uniswapV2RouterContract.address, MAX_UINT256],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    const { ethOut } = await quoteDexSell(token, tokenIn);
    const minOut = applySlippage(ethOut, "min", slippageTolerance);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + (txDeadline * MINUTE));

    const { request } = await uniswapV2RouterContract.simulate.swapExactTokensForETH(
      [amount, minOut, [token.address, wethAddress], walletClient.account.address, deadline],
      { account: walletClient.account.address },
    );
    const hash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  };

  return {
    quoteDexBuy,
    quoteDexBuyForTokens,
    quoteDexSell,
    dexBuyToken,
    dexBuyTokenForTokens,
    dexSellToken,
  };
}
