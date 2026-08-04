# LCAI Launchpad — local Anvil development
#
# Quick start:
#   make setup    # install deps + seed env files
#   make start    # postgres + anvil + deploy + all apps
#
# Other:
#   make infra    # postgres + anvil only
#   make deploy   # deploy contracts to anvil + sync app .env
#   make apps     # pnpm dev (indexer + api + web)
#   make down     # stop infra
#   make reset    # wipe volumes, redeploy, restart apps
#   make logs     # follow docker logs
#   make help

SHELL := /bin/bash
.DEFAULT_GOAL := help

ROOT          := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
COMPOSE       := docker compose -f $(ROOT)/docker-compose.dev.yml
RPC_URL       ?= http://127.0.0.1:8545
POSTGRES_HOST ?= 127.0.0.1
POSTGRES_PORT ?= 5432

.PHONY: help setup infra up down reset logs wait deploy sync-env abis apps start stop smoke

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage: make \033[36m<target>\033[0m\n\n"} \
		/^[a-zA-Z0-9_-]+:.*?##/ { printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo

setup: ## Install deps and seed .env files from examples
	@command -v pnpm >/dev/null || { echo "pnpm required (corepack enable && corepack prepare pnpm@10 --activate)"; exit 1; }
	@command -v docker >/dev/null || { echo "docker required"; exit 1; }
	pnpm install
	pnpm --filter @lcai/abis build
	cd $(ROOT)/contracts && npm install
	@test -f $(ROOT)/apps/indexer/.env || cp $(ROOT)/apps/indexer/.env.example $(ROOT)/apps/indexer/.env
	@test -f $(ROOT)/apps/api/.env || cp $(ROOT)/apps/api/.env.example $(ROOT)/apps/api/.env
	@test -f $(ROOT)/apps/web/.env.local || cp $(ROOT)/apps/web/.env.example $(ROOT)/apps/web/.env.local
	@echo "Setup complete. Next: make start"

infra: ## Start Postgres + Anvil (Docker)
	$(COMPOSE) up -d
	@$(ROOT)/scripts/dev/wait-postgres.sh $(POSTGRES_HOST) $(POSTGRES_PORT) 60
	@$(ROOT)/scripts/dev/wait-rpc.sh $(RPC_URL) 60
	@echo "Infra ready:"
	@echo "  Postgres  → $(POSTGRES_HOST):$(POSTGRES_PORT)  (user/pass lcai/lcai, db lcai_launchpad)"
	@echo "  Anvil RPC → $(RPC_URL)  (chainId 1337)"
	@echo "  Anvil #0  → 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
	@echo "              pk 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

up: infra ## Alias for infra

down: ## Stop Postgres + Anvil (keep volumes)
	$(COMPOSE) down

reset: ## Wipe DB + Anvil state, redeploy, print next steps
	$(COMPOSE) down -v
	$(MAKE) infra
	$(MAKE) deploy
	@echo
	@echo "Reset done. Start apps with: make apps"

logs: ## Follow infra logs
	$(COMPOSE) logs -f

wait: ## Wait for Postgres + Anvil health
	@$(ROOT)/scripts/dev/wait-postgres.sh $(POSTGRES_HOST) $(POSTGRES_PORT) 60
	@$(ROOT)/scripts/dev/wait-rpc.sh $(RPC_URL) 60

deploy: ## Compile, deploy to Anvil, sync app env, regen ABIs
	@$(ROOT)/scripts/dev/deploy-local.sh

sync-env: ## Re-apply deployment JSON → app .env files
	@$(ROOT)/scripts/dev/sync-env.sh

abis: ## Regenerate + build @lcai/abis from Hardhat artifacts
	cd $(ROOT)/contracts && npx hardhat compile
	pnpm gen:abis
	pnpm --filter @lcai/abis build

apps: ## Run indexer + api + web (host, via Turborepo)
	pnpm --filter @lcai/abis build
	pnpm dev

start: ## Full local stack: infra → deploy → apps
	$(MAKE) infra
	$(MAKE) deploy
	$(MAKE) apps

stop: down ## Alias for down

smoke: ## Hit API health / status / tokens (apps must be running)
	@curl -sf http://localhost:3001/v1/health | tee /dev/stderr | grep -q . && echo
	@curl -sf http://localhost:3001/v1/status && echo
	@curl -sf http://localhost:3001/v1/tokens && echo
