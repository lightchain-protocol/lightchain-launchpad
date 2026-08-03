import type { FastifyPluginAsync } from "fastify";
import { createPublicClient, http } from "viem";

import { config } from "../config.js";
import { getAccount, search as searchTokens, indexedBlock } from "../db/queries.js";
import { toTokenDTO, toTradeDTO } from "../dto.js";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const publicClient = createPublicClient({ transport: http(config.RPC_URL) });

const plugin: FastifyPluginAsync = async (app) => {
  // GET /v1/accounts/:address
  app.get<{ Params: { address: string } }>(
    "/accounts/:address",
    { schema: { tags: ["accounts"], summary: "Tokens created / held / recently traded by an address" } },
    async (req, reply) => {
      const address = req.params.address;
      if (!ADDRESS_RE.test(address)) return reply.code(400).send({ error: "invalid address" });
      const acc = await getAccount(address);
      return {
        address: address.toLowerCase(),
        created: acc.created.map((t) => toTokenDTO(t.token, t.metadata)),
        holdings: acc.holdings.map((h) => ({ token: h.token, balance: h.balance.toString() })),
        recentTrades: acc.recentTrades.map(toTradeDTO),
      };
    },
  );

  // GET /v1/search?q=
  app.get<{ Querystring: { q?: string; limit?: number } }>(
    "/search",
    {
      schema: {
        tags: ["search"],
        summary: "Search tokens by name / symbol / address",
        querystring: {
          type: "object",
          required: ["q"],
          properties: { q: { type: "string", minLength: 1 }, limit: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
        },
      },
    },
    async (req) => {
      const q = (req.query.q ?? "").trim();
      const limit = Math.max(1, Math.min(50, req.query.limit ?? 20));
      if (q.length === 0) return { data: [] };
      const results = await searchTokens(q, limit);
      return { data: results.map((r) => toTokenDTO(r.token, r.metadata)) };
    },
  );

  // GET /v1/status — indexer sync status
  app.get(
    "/status",
    { schema: { tags: ["system"], summary: "Indexer sync status (let the UI show a 'syncing…' state)" } },
    async () => {
      const indexed = await indexedBlock();
      let head: bigint | null = null;
      let chainId: number | null = null;
      try {
        head = await publicClient.getBlockNumber();
        chainId = await publicClient.getChainId();
      } catch {
        /* RPC unreachable */
      }
      const lag = head != null ? Number(head - indexed) : null;
      return {
        indexedBlock: indexed.toString(),
        headBlock: head?.toString() ?? null,
        lag,
        isSynced: lag != null ? lag <= 2 : null,
        chainId,
      };
    },
  );
};

export default plugin;
