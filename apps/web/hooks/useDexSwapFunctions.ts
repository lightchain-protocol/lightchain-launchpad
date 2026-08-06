import { parseEther } from "viem";
import { erc20Abi } from "viem";

import { Token } from "@/types";
import { applySlippage, deadlineFromNow, MAX_UINT256 } from "@/lib/utils";
import useUserStore from "@/store/user-store";
import useWeb3Clients from "./useWeb3Clients";
import useCurrentChain from "./useCurrentChain";
import config from "@/config";
import useContracts from "./useContracts";

export default function useDexSwapFunctions() {
  const chain = useCurrentChain();
  const { publicClient, walletClient } = useWeb3Clients();
  const { uniswapV2RouterContract } = useContracts();
  const { slippageTolerance, txDeadline } = useUserStore();

  const wethAddress = config.weth[chain.id];

  /** See useTradeFunctions.requireWallet — an early return here was a silent no-op. */
  const requireDex = () => {
    if (!walletClient) throw new Error("Wallet not connected — reconnect and try again");
    if (!wethAddress) throw new Error("WETH unavailable on this network");
    return { wallet: walletClient, weth: wethAddress };
  };

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

  /** Buy with `ethIn` native; `shownTokensOut` is the quote the UI displayed. */
  const dexBuyToken = async (
    token: Token,
    ethIn: string,
    shownTokensOut: bigint,
  ): Promise<`0x${string}`> => {
    const { wallet, weth } = requireDex();

    const minOut = applySlippage(shownTokensOut, "min", slippageTolerance);
    const deadline = deadlineFromNow(txDeadline);

    const { request } = await uniswapV2RouterContract.simulate.swapExactETHForTokens(
      [minOut, [weth, token.address], wallet.account.address, deadline],
      { value: parseEther(ethIn), account: wallet.account.address },
    );
    const hash = await wallet.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  };

  /**
   * Buy an exact token amount. `shownEthIn` is the cost the UI displayed; the
   * tolerance-capped maximum is sent as `msg.value` and the router refunds
   * whatever it does not use, so the cap IS the guarantee.
   */
  const dexBuyTokenForTokens = async (
    token: Token,
    tokensOut: string,
    shownEthIn: bigint,
  ): Promise<`0x${string}`> => {
    const { wallet, weth } = requireDex();

    const desired = parseEther(tokensOut);
    const maxEthIn = applySlippage(shownEthIn, "max", slippageTolerance);
    const deadline = deadlineFromNow(txDeadline);

    const { request } = await uniswapV2RouterContract.simulate.swapETHForExactTokens(
      [desired, [weth, token.address], wallet.account.address, deadline],
      { value: maxEthIn, account: wallet.account.address },
    );
    const hash = await wallet.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  };

  /** Sell `tokenIn` tokens; `shownEthOut` is the quote the UI displayed. */
  const dexSellToken = async (
    token: Token,
    tokenIn: string,
    shownEthOut: bigint,
  ): Promise<`0x${string}`> => {
    const { wallet, weth } = requireDex();

    const amount = parseEther(tokenIn);

    const allowance = await publicClient.readContract({
      address: token.address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [wallet.account.address, uniswapV2RouterContract.address],
    });
    if (allowance < amount) {
      const approveHash = await wallet.writeContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [uniswapV2RouterContract.address, MAX_UINT256],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    const minOut = applySlippage(shownEthOut, "min", slippageTolerance);
    const deadline = deadlineFromNow(txDeadline);

    const { request } = await uniswapV2RouterContract.simulate.swapExactTokensForETH(
      [amount, minOut, [token.address, weth], wallet.account.address, deadline],
      { account: wallet.account.address },
    );
    const hash = await wallet.writeContract(request);
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
