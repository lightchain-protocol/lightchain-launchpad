import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import "dotenv/config";

const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || "";
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || "";

// Mainnet forking is only enabled when an Alchemy key is provided. The full
// test-suite (including the graduation path) runs against in-repo Uniswap V2
// mocks and does NOT require a fork; the optional `*.fork.ts` specs do.
const forking = ALCHEMY_API_KEY ? { url: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}` } : undefined;

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      // Uniswap V2 core (Pair/Factory) — pinned `pragma solidity =0.5.16`.
      // `runs: 999999` matches Uniswap's own build so the compiled Pair is the
      // one the protocol actually ships.
      {
        version: "0.5.16",
        settings: { optimizer: { enabled: true, runs: 999999 } },
      },
      // Uniswap V2 periphery (Router02/WETH9) — pinned `pragma solidity =0.6.6`.
      {
        version: "0.6.6",
        settings: { optimizer: { enabled: true, runs: 999999 } },
      },
      {
        version: "0.8.28",
        settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
      },
    ],
  },
  networks: {
    hardhat: forking ? { forking } : {},
    localhost: {
      url: process.env.RPC_URL || "http://127.0.0.1:8545",
      chainId: 1337,
      // Omit accounts → Hardhat's well-known keys (same as Anvil defaults).
      accounts: WALLET_PRIVATE_KEY ? [WALLET_PRIVATE_KEY] : undefined,
    },
    lcaiTestnet: {
      url: "https://rpc.testnet.lightchain.ai",
      accounts: WALLET_PRIVATE_KEY ? [WALLET_PRIVATE_KEY] : undefined,
    },
  },
  defaultNetwork: "lcaiTestnet",
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
    enabled: false,
    customChains: [
      {
        chainId: 8200,
        network: "lcaiTestnet",
        urls: {
          apiURL: "https://testnet.lightscan.app/api",
          browserURL: "https://testnet.lightscan.app",
        },
      },
    ],
  },
  blockscout: {
    enabled: true,
    customChains: [
      {
        chainId: 8200,
        network: "lcaiTestnet",
        urls: {
          apiURL: "https://testnet.lightscan.app/api",
          browserURL: "https://testnet.lightscan.app",
        },
      },
    ],
  },
};

export default config;
