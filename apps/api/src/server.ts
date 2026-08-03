import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

import { config } from "./config.js";
import tokensRoutes from "./routes/tokens.js";
import discoveryRoutes from "./routes/discovery.js";
import metadataRoutes from "./routes/metadata.js";
import systemRoutes from "./routes/system.js";
import wsPlugin from "./realtime/ws.js";

const corsOrigin = (): true | string[] =>
  config.CORS_ORIGIN === "*" ? true : config.CORS_ORIGIN.split(",").map((s) => s.trim());

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.NODE_ENV === "development"
        ? { level: config.LOG_LEVEL, transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } }
        : { level: config.LOG_LEVEL },
    trustProxy: true,
    bodyLimit: 1 * 1024 * 1024,
  });

  await app.register(cors, { origin: corsOrigin(), credentials: true });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: config.RATE_LIMIT_GLOBAL_PER_MIN, timeWindow: "1 minute" });
  await app.register(multipart, { limits: { fileSize: config.MAX_IMAGE_BYTES, files: 1, fields: 20 } });
  await app.register(swagger, {
    openapi: {
      info: { title: "LCAI Launchpad API", version: "0.1.0", description: "Chain-derived launchpad data (Ponder-indexed)." },
      servers: [{ url: config.PUBLIC_URL }],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/v1/docs" });

  await app.register(tokensRoutes, { prefix: "/v1" });
  await app.register(discoveryRoutes, { prefix: "/v1" });
  await app.register(metadataRoutes, { prefix: "/v1" });
  await app.register(systemRoutes, { prefix: "/v1" });
  await app.register(wsPlugin);

  app.get("/", async () => ({ name: "lcai-launchpad-api", docs: "/v1/docs", health: "/v1/health" }));

  await app.ready();
  return app;
}
