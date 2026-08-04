import { createConfig, factory } from "ponder";
import { http, parseAbiItem } from "viem";

import { launchpadAbi, tokenAbi, uniswapV2PairAbi } from "@lcai/abis";

const launchpadAddress = (process.env.LAUNCHPAD_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;
const startBlock = Number(process.env.START_BLOCK ?? 0);
const chainId = Number(process.env.CHAIN_ID ?? 1337);
const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";

// The launchpad emits this for every new token. `token` is the freshly-deployed
// ERC20 — Ponder registers it dynamically (factory pattern) so we can index its
// Transfer events for holder balances. Trade/Graduated are emitted by the
// launchpad itself, so they don't need any dynamic registration.
const tokenLaunched = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed creator, string name, string symbol, string metadataURI, uint256 devBuyEth)"
);
const graduated = parseAbiItem(
  "event Graduated(address indexed token, address indexed pair, uint256 ethToLp, uint256 tokensToLp, uint256 tokensBurned, bool degradedPath)"
);

export default createConfig({
  database: { kind: "postgres", connectionString: process.env.DATABASE_URL },
  networks: {
    lcai: {
      chainId,
      transport: http(rpcUrl),
      pollingInterval: 1_000,
    },
  },
  contracts: {
    Launchpad: {
      abi: launchpadAbi,
      network: "lcai",
      address: launchpadAddress,
      startBlock,
    },
    Token: {
      abi: tokenAbi,
      network: "lcai",
      address: factory({ address: launchpadAddress, event: tokenLaunched, parameter: "token" }),
      startBlock,
    },
    UniswapV2Pair: {
      abi: uniswapV2PairAbi,
      network: "lcai",
      address: factory({ address: launchpadAddress, event: graduated, parameter: "pair" }),
      startBlock,
    },
  },
});
