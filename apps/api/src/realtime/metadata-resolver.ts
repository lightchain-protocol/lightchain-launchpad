/**
 * Event-driven background metadata resolver.
 *
 * Two trigger paths, same body:
 *   1. `resolveNow(token)` — called by the pg-listener on
 *      `lcai:metadata:pending` NOTIFYs. Fresh launches resolve in tens of ms.
 *   2. Periodic sweep (default 60 s) — catches retries that are now due, plus
 *      pending rows missed during boot or listener reconnects.
 *
 * Concurrency: at most CONCURRENCY resolves in flight at any time, enforced by
 * an internal queue. NOTIFY-driven calls are coalesced (we never double-resolve
 * the same token because `FOR UPDATE SKIP LOCKED` on the claim refuses to hand
 * the row to a second worker).
 *
 * Every iteration is wrapped in `try/catch`; the resolver must never crash the
 * process. Per-fetch timeouts live in the IPFS service.
 */
import { eq, sql } from "drizzle-orm";

import { tokenMetadata } from "@lcai/indexer/schema";

import { db } from "../db/client.js";
import { claimPendingMetadata, claimPendingMetadataByToken, getToken } from "../db/queries.js";
import { fetchTokenMetadata, repinCid, parseIpfsUri, toDisplayUrl } from "../services/ipfs.js";
import { toTokenDTO } from "../dto.js";
import { tokenUpdateFromDTO } from "./token-update.js";

const MAX_ATTEMPTS = 8;
const SWEEP_BATCH = 9;
const CONCURRENCY = 3;
const SWEEP_INTERVAL_MS = 60_000;
const BACKOFF_BASE_SEC = 60; // exponential: 60s, 120s, 240s, …

type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export class MetadataResolver {
  private readonly log: Logger;
  private timer?: NodeJS.Timeout;
  private running = false;
  private inflight = 0;

  constructor(log: Logger) {
    this.log = log;
  }

  start(): void {
    this.running = true;
    // One-shot sweep on boot to drain any rows queued before the listener attached.
    void this.sweep().catch((err) => this.log.error({ err }, "metadata resolver boot sweep failed"));
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.log.info({ sweepIntervalMs: SWEEP_INTERVAL_MS, concurrency: CONCURRENCY }, "metadata resolver started");
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * NOTIFY-driven path. Called when the indexer emits `lcai:metadata:pending`
   * after inserting a fresh row. Resolves one specific token immediately.
   * Concurrency-capped: if we're already at CONCURRENCY, drop this call —
   * the sweep timer will pick it up later.
   */
  async resolveNow(tokenAddr: string): Promise<void> {
    if (!this.running) return;
    if (this.inflight >= CONCURRENCY) return;

    let claimed: { token: string; metadataUri: string; attempts: number } | null = null;
    try {
      claimed = await claimPendingMetadataByToken(tokenAddr);
    } catch (err) {
      this.log.warn({ err, tokenAddr }, "claim-by-token failed");
      return;
    }
    if (!claimed) return; // not pending / already claimed elsewhere

    this.inflight++;
    try {
      await this.resolveOne(claimed.token, claimed.metadataUri, claimed.attempts);
    } finally {
      this.inflight--;
    }
  }

  /**
   * Periodic catch-up: claims a batch of pending/retryable rows and resolves
   * them at CONCURRENCY in parallel. Idempotent; safe if `resolveNow` is
   * concurrently processing the same row (SKIP LOCKED makes the rows
   * mutually exclusive).
   */
  private async sweep(): Promise<void> {
    if (!this.running) return;
    let pending: Awaited<ReturnType<typeof claimPendingMetadata>>;
    try {
      pending = await claimPendingMetadata(SWEEP_BATCH);
    } catch (err) {
      this.log.error({ err }, "metadata resolver sweep claim failed");
      return;
    }
    if (pending.length === 0) return;

    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        batch.map((p) => {
          this.inflight++;
          return this.resolveOne(p.token, p.metadataUri, p.attempts).finally(() => {
            this.inflight--;
          });
        }),
      );
    }
  }

  private async resolveOne(tokenAddr: string, metadataUri: string, attempts: number): Promise<void> {
    const token = tokenAddr.toLowerCase() as `0x${string}`;
    const nowSec = BigInt(Math.floor(Date.now() / 1000));

    try {
      const meta = await fetchTokenMetadata(metadataUri);

      const cid = parseIpfsUri(metadataUri)?.cid;
      if (cid) void repinCid(cid).catch(() => undefined);
      const imgCid = meta.image ? parseIpfsUri(meta.image)?.cid : undefined;
      if (imgCid) void repinCid(imgCid).catch(() => undefined);

      await db
        .update(tokenMetadata)
        .set({
          status: "ok",
          description: meta.description ?? null,
          imageUrl: toDisplayUrl(meta.image) ?? null,
          bannerUrl: toDisplayUrl(meta.banner) ?? null,
          website: meta.website ?? null,
          twitter: meta.twitter ?? null,
          telegram: meta.telegram ?? null,
          discord: meta.discord ?? null,
          tags: meta.tags ?? [],
          raw: meta as Record<string, unknown>,
          attempts: attempts + 1,
          error: null,
          nextAttemptAt: null,
          resolvedAt: nowSec,
          updatedAt: nowSec,
        })
        .where(eq(tokenMetadata.token, token));

      const tk = await getToken(token);
      if (tk) {
        const dto = toTokenDTO(tk.token, tk.metadata);
        const payload = tokenUpdateFromDTO(dto);
        await db.execute(
          sql`select pg_notify('lcai:token:update', ${JSON.stringify(payload)})`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const nextAttempts = attempts + 1;
      const finalFail = nextAttempts >= MAX_ATTEMPTS;
      const status = finalFail ? "unavailable" : "failed";
      const backoffSec = BACKOFF_BASE_SEC * Math.pow(2, nextAttempts - 1);
      const nextAt = finalFail ? null : nowSec + BigInt(backoffSec);

      await db
        .update(tokenMetadata)
        .set({
          status,
          attempts: nextAttempts,
          error: message,
          nextAttemptAt: nextAt,
          updatedAt: nowSec,
        })
        .where(eq(tokenMetadata.token, token))
        .catch((dbErr) => {
          this.log.error({ dbErr, token, message }, "failed to record metadata error");
        });

      this.log.warn({ token, attempt: nextAttempts, err: message }, "metadata resolve failed");
    }
  }
}
