import type { FastifyPluginAsync } from "fastify";

import {
  listTokens,
  listTrendingTokens,
  getToken,
  getTokenStats,
  listTrades,
  listRecentTrades,
  getCandles,
  getGraduation,
  topHolders,
  type TokenSort,
  type TokenStatus,
} from "../db/queries.js";
import {
  toTokenDTO,
  toTokenDetailDTO,
  toTrendingTokenDTO,
  toTradeDTO,
  toGraduationDTO,
  toHolderDTO,
  toCandleDTO,
  pageMeta,
  CANDLE_INTERVALS,
  type Paginated,
  type TokenDTO,
  type TrendingTokenDTO,
  type GraduationDTO,
} from "../dto.js";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

const paginationSchema = {
  page: { type: "integer", minimum: 1, default: 1 },
  limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
} as const;

const plugin: FastifyPluginAsync = async (app) => {
  // GET /v1/tokens
  app.get<{
    Querystring: { page?: number; limit?: number; search?: string; tag?: string; status?: TokenStatus; sort?: TokenSort };
  }>(
    "/tokens",
    {
      schema: {
        tags: ["tokens"],
        summary: "List tokens with search / filter / sort / pagination",
        querystring: {
          type: "object",
          properties: {
            ...paginationSchema,
            search: { type: "string" },
            tag: { type: "string" },
            status: { type: "string", enum: ["all", "bonding", "graduated"], default: "all" },
            sort: {
              type: "string",
              enum: ["newest", "oldest", "marketCap", "volume24h", "lastTrade", "graduating"],
              default: "newest",
            },
          },
        },
      },
    },
    async (req): Promise<Paginated<TokenDTO & { volume24h: string }>> => {
      const q = req.query;
      const page = q.page ?? 1;
      const limit = clamp(q.limit ?? 20, 1, 100);
      const { items, total } = await listTokens({
        search: q.search,
        tag: q.tag,
        status: q.status ?? "all",
        sort: q.sort ?? "newest",
        page,
        limit,
      });
      return {
        data: items.map((it) => ({ ...toTokenDTO(it.token, it.metadata), volume24h: it.volume24h.toString() })),
        meta: pageMeta(total, page, limit),
      };
    },
  );

  // GET /v1/tokens/trending — must be registered before /tokens/:address
  app.get<{ Querystring: { limit?: number } }>(
    "/tokens/trending",
    {
      schema: {
        tags: ["tokens"],
        summary: "Trending bonding tokens by 24h volume (homepage carousel)",
        querystring: {
          type: "object",
          properties: { limit: { type: "integer", minimum: 1, maximum: 24, default: 12 } },
        },
      },
    },
    async (req): Promise<{ data: TrendingTokenDTO[] }> => {
      const limit = clamp(req.query.limit ?? 12, 1, 24);
      const items = await listTrendingTokens(limit);
      return {
        data: items.map((it) =>
          toTrendingTokenDTO(it.token, it.metadata, it.volume24h, it.priceChange24hBps),
        ),
      };
    },
  );

  // GET /v1/tokens/:address
  app.get<{ Params: { address: string } }>(
    "/tokens/:address",
    { schema: { tags: ["tokens"], summary: "Token detail with curve state, stats and resolved metadata" } },
    async (req, reply) => {
      const address = req.params.address;
      if (!ADDRESS_RE.test(address)) return reply.code(400).send({ error: "invalid address" });
      const tk = await getToken(address);
      if (!tk) return reply.code(404).send({ error: "token not found" });
      const stats = await getTokenStats(tk.token);
      return toTokenDetailDTO(tk.token, tk.metadata, stats);
    },
  );

  // GET /v1/tokens/:address/graduation — must be registered before /tokens/:address/trades
  app.get<{ Params: { address: string } }>(
    "/tokens/:address/graduation",
    { schema: { tags: ["tokens"], summary: "Graduation details (Uniswap V2 pair, LP amounts)" } },
    async (req, reply): Promise<GraduationDTO> => {
      const address = req.params.address;
      if (!ADDRESS_RE.test(address)) return reply.code(400).send({ error: "invalid address" });
      const row = await getGraduation(address);
      if (!row) return reply.code(404).send({ error: "graduation not found" });
      return toGraduationDTO({
        token: row.token as string,
        pair: row.pair as string,
        ethToLp: BigInt(String(row.ethToLp)),
        tokensToLp: BigInt(String(row.tokensToLp)),
        tokensBurned: BigInt(String(row.tokensBurned)),
        degradedPath: Boolean(row.degradedPath),
        txHash: row.txHash as string,
        blockNumber: BigInt(String(row.blockNumber)),
        timestamp: BigInt(String(row.timestamp)),
      });
    },
  );

  // GET /v1/tokens/:address/trades
  app.get<{ Params: { address: string }; Querystring: { page?: number; limit?: number } }>(
    "/tokens/:address/trades",
    {
      schema: {
        tags: ["tokens"],
        summary: "Trade history for a token",
        querystring: { type: "object", properties: paginationSchema },
      },
    },
    async (req, reply) => {
      const address = req.params.address;
      if (!ADDRESS_RE.test(address)) return reply.code(400).send({ error: "invalid address" });
      const page = req.query.page ?? 1;
      const limit = clamp(req.query.limit ?? 20, 1, 100);
      const { items, total } = await listTrades(address, page, limit);
      return { data: items.map(toTradeDTO), meta: pageMeta(total, page, limit) };
    },
  );

  // GET /v1/trades — global recent trades
  app.get<{ Querystring: { limit?: number } }>(
    "/trades",
    {
      schema: {
        tags: ["trades"],
        summary: "Recent trades across all tokens",
        querystring: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 200, default: 50 } } },
      },
    },
    async (req) => {
      const limit = clamp(req.query.limit ?? 50, 1, 200);
      return { data: (await listRecentTrades(limit)).map(toTradeDTO) };
    },
  );

  // GET /v1/tokens/:address/candles
  app.get<{
    Params: { address: string };
    Querystring: { interval?: string; from?: number; to?: number; limit?: number };
  }>(
    "/tokens/:address/candles",
    {
      schema: {
        tags: ["tokens"],
        summary: "OHLCV candlesticks (TradingView-friendly)",
        querystring: {
          type: "object",
          properties: {
            interval: { type: "string", enum: Object.keys(CANDLE_INTERVALS), default: "1m" },
            from: { type: "integer", description: "unix seconds" },
            to: { type: "integer", description: "unix seconds" },
            limit: { type: "integer", minimum: 1, maximum: 5000, default: 1000 },
          },
        },
      },
    },
    async (req, reply) => {
      const address = req.params.address;
      if (!ADDRESS_RE.test(address)) return reply.code(400).send({ error: "invalid address" });
      const intervalKey = req.query.interval ?? "1m";
      const interval = CANDLE_INTERVALS[intervalKey];
      if (!interval) return reply.code(400).send({ error: "invalid interval" });
      const rows = await getCandles({
        token: address,
        interval,
        from: req.query.from,
        to: req.query.to,
        limit: clamp(req.query.limit ?? 1000, 1, 5000),
      });
      return { interval: intervalKey, data: rows.map(toCandleDTO) };
    },
  );

  // GET /v1/tokens/:address/holders
  app.get<{ Params: { address: string }; Querystring: { limit?: number } }>(
    "/tokens/:address/holders",
    {
      schema: {
        tags: ["tokens"],
        summary: "Top holders (launchpad / pair / dead excluded)",
        querystring: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 200, default: 50 } } },
      },
    },
    async (req, reply) => {
      const address = req.params.address;
      if (!ADDRESS_RE.test(address)) return reply.code(400).send({ error: "invalid address" });
      const tk = await getToken(address);
      if (!tk) return reply.code(404).send({ error: "token not found" });
      const limit = clamp(req.query.limit ?? 50, 1, 200);
      const holders = await topHolders(tk.token.address, tk.token.pair, limit);
      return {
        token: tk.token.address,
        totalSupply: tk.token.totalSupply.toString(),
        data: holders.map((h) => toHolderDTO(h.address, h.balance, tk.token.totalSupply)),
      };
    },
  );
};

export default plugin;
