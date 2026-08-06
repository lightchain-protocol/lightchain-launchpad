import { decodeEventLog, parseEther } from "viem";
import { erc20Abi } from "viem";

import { Token } from "@/types";
import { launchpadAbi } from "@lcai/abis";
import { applySlippage, MAX_UINT256 } from "@/lib/utils";
import useUserStore from "@/store/user-store";
import useContracts from "./useContracts";
import useWeb3Clients from "./useWeb3Clients";

export default function useTradeFunctions() {
  const { publicClient, walletClient } = useWeb3Clients();
  const { launchpadContract } = useContracts();
  const { slippageTolerance } = useUserStore();

  /**
   * The wallet client resolves asynchronously. Returning early here used to make
   * the Buy button a silent no-op — no error, no toast, no spinner change.
   * Throwing routes into the forms' existing onError toast.
   */
  const requireWallet = () => {
    if (!walletClient) throw new Error("Wallet not connected — reconnect and try again");
    return walletClient;
  };

  /** ETH-in → token-out quote. Returns the net ETH spent and tokens received. */
  const quoteBuy = async (
    token: Pick<Token, "address">,
    ethIn: string,
  ): Promise<{ tokensOut: bigint; ethInNet: bigint; fee: bigint; refund: bigint }> => {
    const [tokensOut, ethInNet, fee, refund] =
      await launchpadContract.read.quoteBuy([token.address, parseEther(ethIn)]);
    return { tokensOut, ethInNet, fee, refund };
  };

  /** Exact token-out → gross ETH-in quote via on-chain `quoteBuyForTokens`. */
  const quoteBuyForTokens = async (
    token: Pick<Token, "address">,
    tokensOut: string,
  ): Promise<{ ethIn: bigint; ethInNet: bigint; fee: bigint; tokensOut: bigint }> => {
    const desired = parseEther(tokensOut);
    const [ethIn, ethInNet, fee] = await launchpadContract.read.quoteBuyForTokens([
      token.address,
      desired,
    ]);
    return { ethIn, ethInNet, fee, tokensOut: desired };
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

  /**
   * Buy tokens with `ethIn` native. `shownTokensOut` is the quote the UI
   * displayed; the enforced `minTokensOut` is derived from it, so the floor the
   * chain enforces is the number the user actually read.
   */
  const buyToken = async (
    token: Token,
    ethIn: string,
    shownTokensOut: bigint,
  ): Promise<`0x${string}`> => {
    const wallet = requireWallet();
    if (token.graduated) throw new Error("token has graduated; trade on the DEX");

    const minTokensOut = applySlippage(shownTokensOut, "min", slippageTolerance);

    const { request } = await launchpadContract.simulate.buy(
      [token.address, minTokensOut],
      { value: parseEther(ethIn), account: wallet.account.address },
    );
    const hash = await wallet.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  };

  /**
   * Buy an exact token amount. The curve's `buy` is exact-native-in and only
   * refunds a supply-clamped overshoot, so `msg.value` still has to come from a
   * fresh quote — but `shownEthIn`, the cost the UI displayed, caps it. A
   * re-quote above tolerance aborts before the wallet opens instead of silently
   * overcharging.
   */
  const buyTokenForTokens = async (
    token: Token,
    tokensOut: string,
    shownEthIn: bigint,
  ): Promise<`0x${string}`> => {
    const wallet = requireWallet();
    if (token.graduated) throw new Error("token has graduated; trade on the DEX");

    const maxEthIn = applySlippage(shownEthIn, "max", slippageTolerance);
    const { ethIn, tokensOut: desired } = await quoteBuyForTokens(token, tokensOut);
    if (ethIn > maxEthIn) {
      throw new Error("Price moved beyond your slippage tolerance — refresh the quote");
    }

    const minTokensOut = applySlippage(desired, "min", slippageTolerance);

    const { request } = await launchpadContract.simulate.buy(
      [token.address, minTokensOut],
      { value: ethIn, account: wallet.account.address },
    );
    const hash = await wallet.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  };

  /**
   * Sell `tokenIn` tokens for native. `shownEthOut` is the quote the UI
   * displayed; `minEthOut` is derived from it. Pre-approves the launchpad once
   * (max allowance) when the allowance is short.
   */
  const sellToken = async (
    token: Token,
    tokenIn: string,
    shownEthOut: bigint,
  ): Promise<`0x${string}`> => {
    const wallet = requireWallet();
    if (token.graduated) throw new Error("token has graduated; trade on the DEX");

    const tokenAmount = parseEther(tokenIn);
    const allowance = await publicClient.readContract({
      address: token.address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [wallet.account.address, launchpadContract.address],
    });
    if (allowance < tokenAmount) {
      const approveHash = await wallet.writeContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [launchpadContract.address, MAX_UINT256],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    const minEthOut = applySlippage(shownEthOut, "min", slippageTolerance);

    const { request } = await launchpadContract.simulate.sell(
      [token.address, tokenAmount, minEthOut],
      { account: wallet.account.address },
    );
    const hash = await wallet.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  };

  return {
    createToken,
    buyToken,
    buyTokenForTokens,
    sellToken,
    quoteBuy,
    quoteBuyForTokens,
    quoteSell,
  };
}
