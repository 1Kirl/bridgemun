import "server-only";

/**
 * Deadline scheduler abstraction. The engine emits `schedule` effects; a driver must later deliver
 * a `tick` for (forumId, phaseId) at or after `atMs`. Delivery may be duplicated, early or late:
 * the engine ignores ticks whose phase moved on or whose deadline is not reached, so drivers can be
 * at-least-once.
 */
export type ScheduledJob = { forumId: string; phaseId: string; atMs: number };
export type JobHandler = (job: ScheduledJob) => Promise<void>;

export interface Scheduler {
  readonly driver: string;
  schedule(job: ScheduledJob): Promise<void>;
}

/** In-process timers. Development/tests only — lost on restart and invisible to other instances. */
export class LocalScheduler implements Scheduler {
  readonly driver = "local";
  private timers = new Set<ReturnType<typeof setTimeout>>();
  constructor(
    private handler: JobHandler,
    private now: () => number = Date.now,
  ) {}
  async schedule(job: ScheduledJob) {
    const delay = Math.max(0, job.atMs - this.now()) + 25;
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.handler(job).catch((e) => console.error("[scheduler:local] tick failed", e));
    }, delay);
    this.timers.add(t);
  }
  cancelAll() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
  get pending() {
    return this.timers.size;
  }
}

/**
 * Upstash QStash driver (recommended for Vercel). NOT CONNECTED / NOT VERIFIED yet:
 * requires QSTASH_TOKEN, APP_BASE_URL and the tick endpoint with signature verification (Phase 3).
 */
export class QStashScheduler implements Scheduler {
  readonly driver = "qstash";
  constructor(
    private cfg: { token: string; baseUrl: string; apiBase?: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}
  async schedule(job: ScheduledJob) {
    const target = `${this.cfg.baseUrl.replace(/\/$/, "")}/api/engine/tick`;
    const res = await this.fetchImpl(`${this.cfg.apiBase ?? "https://qstash.upstash.io"}/v2/publish/${target}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.token}`,
        "Content-Type": "application/json",
        "Upstash-Not-Before": String(Math.ceil(job.atMs / 1000)),
        "Upstash-Deduplication-Id": `${job.forumId}-${job.phaseId}-${job.atMs}`,
        "Upstash-Retries": "3",
      },
      body: JSON.stringify(job),
    });
    if (!res.ok) throw new Error(`QStash publish failed: HTTP ${res.status}`);
  }
}

export function createScheduler(
  env: Record<string, string | undefined>,
  handler: JobHandler,
): Scheduler {
  const driver = env.SCHEDULER_DRIVER;
  if (driver === "local") {
    if (env.VERCEL || env.NODE_ENV === "production") {
      throw new Error("SCHEDULER_DRIVER=local is not allowed in production (timers would be lost).");
    }
    return new LocalScheduler(handler);
  }
  if (driver === "qstash") {
    // APP_BASE_URL should be set explicitly; Vercel's production domain is a safe fallback.
    const baseUrl = env.APP_BASE_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
    if (!env.QSTASH_TOKEN || !baseUrl) throw new Error("QStash scheduler requires QSTASH_TOKEN and APP_BASE_URL.");
    return new QStashScheduler({ token: env.QSTASH_TOKEN, baseUrl });
  }
  throw new Error(`SCHEDULER_DRIVER must be "local" or "qstash" (got ${JSON.stringify(driver)}).`);
}
