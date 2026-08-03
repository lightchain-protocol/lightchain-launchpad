import { cookieStorage, createStorage } from '@wagmi/core'
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";

import index from ".";

export const projectId = "675ab88c974b1d13ffc2fe0bc470bf1a";

if (!projectId) {
  throw new Error("Project ID is not defined");
}

export const networks = index.chains;
//Set up the Wagmi Adapter (Config)
export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({
    storage: cookieStorage,
  }),
  ssr: true,
  projectId,
  networks,
});

export const config = wagmiAdapter.wagmiConfig;
