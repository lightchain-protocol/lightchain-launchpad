import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@lcai/ui"],
  turbopack: {
    resolveAlias: {
      // @wagmi/connectors re-exports Tempo connectors that optionally import `accounts`.
      accounts: "./lib/wagmi/empty-module.js",
    },
  },
  webpack: (config, { dir }) => {
    config.externals.push("pino-pretty", "lokijs", "encoding")
    config.resolve.alias = {
      ...config.resolve.alias,
      accounts: `${dir}/lib/wagmi/empty-module.js`,
    }
    return config
  },
}

export default nextConfig
