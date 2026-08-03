import type { Chain } from "viem";

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