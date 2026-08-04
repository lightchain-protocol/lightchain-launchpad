#!/usr/bin/env bash
# Sync env files for local Anvil from contracts/deployments/localhost.json.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEPLOYMENT="${1:-$ROOT/contracts/deployments/localhost.json}"

if [[ ! -f "$DEPLOYMENT" ]]; then
  echo "Missing deployment file: $DEPLOYMENT" >&2
  echo "Run: make deploy" >&2
  exit 1
fi

read -r LAUNCHPAD START_BLOCK DEX_ROUTER WETH CHAIN_ID < <(
  python3 - "$DEPLOYMENT" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
weth = d.get("weth") or ""
print(d["launchpad"], d["startBlock"], d["dexRouter"], weth, d["chainId"])
PY
)

# Match docker-compose.dev.yml default host port (${POSTGRES_PORT:-5432}).
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
DATABASE_URL="${DATABASE_URL:-postgresql://lcai:lcai@127.0.0.1:${POSTGRES_PORT}/lcai_launchpad}"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"

upsert_env() {
  local file="$1" key="$2" value="$3"
  mkdir -p "$(dirname "$file")"
  if [[ ! -f "$file" ]]; then
    touch "$file"
  fi
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    if sed --version >/dev/null 2>&1; then
      sed -i "s|^${key}=.*|${key}=${value}|" "$file"
    else
      sed -i '' "s|^${key}=.*|${key}=${value}|" "$file"
    fi
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

sync_indexer_env() {
  local file="$1"
  upsert_env "$file" "DATABASE_URL" "\"$DATABASE_URL\""
  upsert_env "$file" "DATABASE_SCHEMA" "\"public\""
  upsert_env "$file" "RPC_URL" "\"$RPC_URL\""
  upsert_env "$file" "CHAIN_ID" "\"$CHAIN_ID\""
  upsert_env "$file" "LAUNCHPAD_ADDRESS" "\"$LAUNCHPAD\""
  upsert_env "$file" "START_BLOCK" "\"$START_BLOCK\""
  upsert_env "$file" "FINALITY_BLOCK_COUNT" "\"0\""
}

seed_from_example() {
  local example="$1" dest="$2"
  if [[ ! -f "$dest" && -f "$example" ]]; then
    cp "$example" "$dest"
    echo "Created $dest from $(basename "$example")"
  fi
}

seed_from_example "$ROOT/apps/indexer/.env.example" "$ROOT/apps/indexer/.env"
seed_from_example "$ROOT/apps/api/.env.example" "$ROOT/apps/api/.env"
seed_from_example "$ROOT/apps/web/.env.example" "$ROOT/apps/web/.env.local"

# Ponder loads .env.local over .env — keep both in sync for Anvil.
sync_indexer_env "$ROOT/apps/indexer/.env"
sync_indexer_env "$ROOT/apps/indexer/.env.local"

# API
upsert_env "$ROOT/apps/api/.env" "DATABASE_URL" "\"$DATABASE_URL\""
upsert_env "$ROOT/apps/api/.env" "RPC_URL" "\"$RPC_URL\""
upsert_env "$ROOT/apps/api/.env" "LAUNCHPAD_ADDRESS" "\"$LAUNCHPAD\""
upsert_env "$ROOT/apps/api/.env" "PORT" "\"3001\""
upsert_env "$ROOT/apps/api/.env" "HOST" "\"0.0.0.0\""
upsert_env "$ROOT/apps/api/.env" "PUBLIC_URL" "\"http://localhost:3001\""
upsert_env "$ROOT/apps/api/.env" "CORS_ORIGIN" "\"*\""

# Frontend — enable Anvil / localhost chain + addresses
upsert_env "$ROOT/apps/web/.env.local" "NEXT_PUBLIC_API_URL" "\"http://localhost:3001/v1\""
upsert_env "$ROOT/apps/web/.env.local" "NEXT_PUBLIC_WEBSCOKET_URL" "\"http://localhost:3001\""
upsert_env "$ROOT/apps/web/.env.local" "NEXT_PUBLIC_ENABLE_LOCALHOST" "\"true\""
upsert_env "$ROOT/apps/web/.env.local" "NEXT_PUBLIC_LAUNCHPAD_ADDRESS" "\"$LAUNCHPAD\""
upsert_env "$ROOT/apps/web/.env.local" "NEXT_PUBLIC_UNISWAP_V2_ROUTER" "\"$DEX_ROUTER\""
if [[ -n "$WETH" ]]; then
  upsert_env "$ROOT/apps/web/.env.local" "NEXT_PUBLIC_WETH_ADDRESS" "\"$WETH\""
fi

echo "Synced local env from $DEPLOYMENT"
echo "  LAUNCHPAD_ADDRESS=$LAUNCHPAD"
echo "  START_BLOCK=$START_BLOCK"
echo "  DEX_ROUTER=$DEX_ROUTER"
echo "  WETH=$WETH"
echo "  CHAIN_ID=$CHAIN_ID"
