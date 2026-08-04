#!/usr/bin/env bash
# Deploy contracts to local Anvil and sync app env files.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"

"$ROOT/scripts/dev/wait-rpc.sh" "$RPC_URL" 60

cd "$ROOT/contracts"
if [[ ! -d node_modules ]]; then
  echo "Installing contracts dependencies..."
  npm install
fi

echo "Compiling contracts..."
npx hardhat compile

echo "Deploying to Anvil at ${RPC_URL}..."
# Anvil account #0 (funded). Override contracts/.env values that dotenv would
# otherwise inject (testnet key / DEX_ROUTER / TREASURY break a fresh Anvil).
# Pre-set empty DEX_ROUTER/TREASURY so dotenv does not re-apply file values.
ANVIL_PK="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
DEX_ROUTER= TREASURY= \
  WALLET_PRIVATE_KEY="${ANVIL_PK}" RPC_URL="${RPC_URL}" \
  npx hardhat run scripts/deploy.ts --network localhost

"$ROOT/scripts/dev/sync-env.sh" "$ROOT/contracts/deployments/localhost.json"

# Regenerate ABIs so apps pick up the latest artifacts
cd "$ROOT"
if command -v pnpm >/dev/null 2>&1; then
  pnpm gen:abis
  pnpm --filter @lcai/abis build
fi

echo "Deploy complete."
