import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import "dotenv/config";

const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || "";
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || "";

// Mainnet forking is only enabled when an Alchemy key is provided. The full
// test-suite (including the graduation path) runs against in-repo Uniswap V2
// mocks and does NOT require a fork; the optional `*.fork.ts` specs do.
const forking = ALCHEMY_API_KEY
  ? { url: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}` }
  : undefined;

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      // kept for Uniswap V2 periphery sources, if ever compiled locally
      {
        version: "0.6.6",
        settings: { optimizer: { enabled: true, runs: 200 } },
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
      url: "http://127.0.0.1:8545",
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
