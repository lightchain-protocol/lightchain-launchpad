import { Chain } from "viem";

export const lcai: Chain = {
  id: 9200,
  name: "LightchainAI",
  nativeCurrency: {
    name: "LightchainAI",
    symbol: "LCAI",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.mainnet.lightchain.ai"],
    },
  },
  blockExplorers: {
    default: {
      name: "LightchainAI Explorer",
      url: "https://mainnet.lightscan.app",
    },
  },
};

export const lcaiTestnet: Chain = {
  id: 8200,
  name: "LightchainAI Testnet",
  nativeCurrency: {
    name: "LightchainAI",
    symbol: "LCAI",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.lightchain.ai"],
    },
  },
  blockExplorers: {
    default: {
      name: "LightchainAI Testnet Explorer",
      url: "https://testnet.lightscan.app",
    },
  },
};
