#!/usr/bin/env bash
# Wait until Anvil (or any JSON-RPC) answers eth_blockNumber.
set -euo pipefail

RPC_URL="${1:-http://127.0.0.1:8545}"
TIMEOUT_SEC="${2:-60}"
deadline=$((SECONDS + TIMEOUT_SEC))

echo "Waiting for RPC at ${RPC_URL} (timeout ${TIMEOUT_SEC}s)..."
while (( SECONDS < deadline )); do
  if curl -sf -X POST "$RPC_URL" \
    -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    | grep -q '"result"'; then
    echo "RPC ready."
    exit 0
  fi
  sleep 1
done

echo "Timed out waiting for ${RPC_URL}" >&2
exit 1
