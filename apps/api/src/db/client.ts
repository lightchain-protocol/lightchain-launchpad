import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@lcai/indexer/schema";

import { config } from "../config.js";

/**
 * Single source of truth for the DB schema: imported directly from
 * `@lcai/indexer/schema` (the Ponder app's `ponder.schema.ts`). Every column
 * rename in the indexer lights up as a typecheck error here.
 */

// One pooled connection for the API's read path. `postgres-js` pools internally.
export const sql = postgres(config.DATABASE_URL, { max: 10 });

// `casing: "snake_case"` mirrors Ponder's storage convention so the camelCase
// JS prop names (e.g. `metadataUri`, `realEthRaised`) map to the snake_case
// columns Ponder writes (e.g. `metadata_uri`, `real_eth_raised`).
export const db = drizzle(sql, { schema, casing: "snake_case" });
export type Db = typeof db;

export { schema };

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
