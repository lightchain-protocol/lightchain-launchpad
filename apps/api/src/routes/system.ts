import type { FastifyPluginAsync } from "fastify";

import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/health", { schema: { tags: ["system"], summary: "Liveness / readiness" } }, async (_req, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "degraded", reason: "database unreachable" });
    }
  });
};

export default plugin;
