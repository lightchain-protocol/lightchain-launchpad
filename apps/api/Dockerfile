# syntax=docker/dockerfile:1
# Build context: repo root (see docker-compose.yml).

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PATH"
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/abis/package.json packages/abis/
COPY apps/api/package.json apps/api/
COPY apps/indexer/package.json apps/indexer/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/abis packages/abis
# Copy source only — a full directory COPY would wipe workspace node_modules symlinks.
COPY apps/indexer/ponder.schema.ts apps/indexer/ponder-env.d.ts apps/indexer/
COPY apps/api/src apps/api/src
COPY apps/api/tsconfig.json apps/api/
RUN pnpm --filter @lcai/abis build
RUN pnpm --filter @lcai/api build

FROM base AS runner
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/tsconfig.base.json ./
COPY --from=build /app/packages/abis ./packages/abis
COPY --from=build /app/apps/indexer ./apps/indexer
COPY --from=build /app/apps/api ./apps/api
WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/main.js"]
