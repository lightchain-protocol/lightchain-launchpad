/**
 * Regression test for the metadata-claim race between `resolveNow()`
 * (NOTIFY-driven) and the `sweep()` timer: both call `claimPendingMetadata*`
 * independently, and before this fix, neither call marked a row as claimed —
 * so a second claim moments later (e.g. while the first claim's IPFS fetch
 * was still in flight) would re-select the same "pending" row and resolve it
 * twice.
 *
 * Requires a real, *reachable* Postgres at DATABASE_URL (see apps/api/.env
 * or apps/api/.env.example). Skips automatically if DATABASE_URL isn't set
 * *or* if it's set but nothing is actually listening there (e.g. running
 * tests without `make infra` up) — apps/api/.env always sets DATABASE_URL,
 * so a presence check alone isn't enough to tell "not configured" apart
 * from "configured but down"; only an actual probe can.
 *
 * NOTE: `../config.js` validates its env schema (and calls `process.exit(1)`
 * on failure) as an import-time side effect, and `./client.js` / `./queries.js`
 * both pull that in transitively. So the DATABASE_URL presence check has to
 * happen *before* importing those — a top-level static import would crash the
 * whole worker rather than skip cleanly whenever DATABASE_URL is unset.
 *
 * This test only needs the `token_metadata` table to exist — it doesn't
 * depend on any of Ponder's on-chain tables — so no indexer/chain fixture is
 * required, just:
 *
 *   create table token_metadata (
 *     token text primary key,
 *     metadata_uri text not null,
 *     status text not null,
 *     description text, image_url text, banner_url text,
 *     website text, twitter text, telegram text, discord text,
 *     tags jsonb, raw jsonb,
 *     attempts integer not null,
 *     next_attempt_at bigint,
 *     error text,
 *     resolved_at bigint,
 *     updated_at bigint not null
 *   );
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
// Load .env directly (not via ../config.js) so we can read DATABASE_URL to
// decide whether to skip *before* triggering config.ts's eager, crashing zod
// validation. dotenv itself never throws on missing vars.
import "dotenv/config";

const hasDbUrl = Boolean(process.env.DATABASE_URL);
const describeIfDbUrl = hasDbUrl ? describe : describe.skip;

const TOKEN = "0xabc0000000000000000000000000000000abc0";

describeIfDbUrl("metadata claim race", () => {
  // Deferred until we know DATABASE_URL is present, so a bare `vitest run`
  // with no test DB configured skips this file instead of crashing the
  // worker on config.ts's eager env validation.
  let sql: typeof import("./client.js").sql;
  let closeDb: typeof import("./client.js").closeDb;
  let claimPendingMetadataByToken: typeof import("./queries.js").claimPendingMetadataByToken;
  let claimPendingMetadata: typeof import("./queries.js").claimPendingMetadata;

  // DATABASE_URL being *set* doesn't mean Postgres is *reachable* --
  // apps/api/.env always sets it, so without this probe, running the suite
  // with the DB down (e.g. no `make infra`) fails every test on a raw
  // ECONNREFUSED instead of skipping cleanly like the "unset" case does.
  let dbReachable = false;

  beforeAll(async () => {
    ({ sql, closeDb } = await import("./client.js"));
    ({ claimPendingMetadataByToken, claimPendingMetadata } = await import("./queries.js"));
    try {
      await sql`select 1`;
      dbReachable = true;
    } catch {
      console.warn(
        "[queries.race.test] DATABASE_URL is set but Postgres is unreachable -- skipping (start it with `make infra` to run this suite).",
      );
    }
  });

  async function seedPending(token: string) {
    await sql`delete from token_metadata where token = ${token}`;
    await sql`
      insert into token_metadata (token, metadata_uri, status, attempts, updated_at)
      values (${token}, 'ipfs://Qm123', 'pending', 0, extract(epoch from now())::bigint)
    `;
  }

  beforeEach(async () => {
    if (!dbReachable) return;
    await seedPending(TOKEN);
  });

  afterAll(async () => {
    if (dbReachable) {
      await sql`delete from token_metadata where token = ${TOKEN}`;
    }
    await closeDb();
  });

  it("does not let a second claim re-select a row still being resolved", async (ctx) => {
    if (!dbReachable) return ctx.skip();

    const claim1 = await claimPendingMetadataByToken(TOKEN);
    expect(claim1).not.toBeNull();
    expect(claim1?.token).toBe(TOKEN);

    // Simulate the first claim's resolveOne() still running its (slow) IPFS
    // fetch — nothing has written a final status yet.
    const claim2 = await claimPendingMetadataByToken(TOKEN);
    expect(claim2).toBeNull();
  });

  it("the batch sweep claim also respects an in-flight single-token claim", async (ctx) => {
    if (!dbReachable) return ctx.skip();

    const claim1 = await claimPendingMetadataByToken(TOKEN);
    expect(claim1).not.toBeNull();

    const swept = await claimPendingMetadata(10);
    expect(swept.find((r) => r.token === TOKEN)).toBeUndefined();
  });
});