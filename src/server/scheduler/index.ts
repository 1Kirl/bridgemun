import "server-only";

/**
 * Deadline scheduler abstraction. The engine emits `schedule` effects; a driver must later deliver
 * a `tick` for (forumId, phaseId) at or after `atMs`. Delivery may be duplicated, early or late:
 * the engine ignores ticks whose phase moved on or whose deadline is not reached, so drivers can be
 * at-least-once.
 */
export type ScheduledJob = { forumId: string; phaseId: string; atMs: number };
export type JobHandler = (job: ScheduledJob) => Promise<void>;

/** `retryTag`: registering again after a lost task — gives the task a fresh name (see CloudTasksScheduler). */
export type ScheduleOptions = { retryTag?: string };

export interface Scheduler {
  readonly driver: string;
  schedule(job: ScheduledJob, opts?: ScheduleOptions): Promise<void>;
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

/** Thrown when the queue refused or could not take a task (the caller records it; the repair path re-arms it). */
export class ScheduleError extends Error {}

type CloudTasksConfig = {
  project: string;
  location: string; // e.g. asia-northeast3
  queue: string; // e.g. engine-ticks
  invokerEmail: string; // service account whose OIDC token Cloud Tasks attaches (no key exists for it)
  baseUrl: string; // public app URL; tasks call `${baseUrl}/api/engine/tick`
  /** OAuth access token of the server's own service account (firebase-admin credential; no extra key). */
  accessToken: () => Promise<string>;
};

/**
 * Google Cloud Tasks driver (production). One HTTP task per deadline, dispatched at the deadline to the app's
 * own /api/engine/tick route with an OIDC token of `invokerEmail` (the route verifies signature, issuer,
 * audience and that exact identity).
 * - Task name = forum + phase + deadline: registering the same deadline twice is a no-op (409 = already there).
 *   Cloud Tasks also answers 409 for a name whose task was deleted or already ran (names stay reserved for about
 *   an hour), so the repair job re-registers with `retryTag` (a new name); a duplicate tick is harmless.
 * - No cancellation: a task whose phase moved on is ignored by the engine (stale / early / duplicate ticks).
 * - Transient queue errors (429, 5xx, network) are retried twice here; anything else throws ScheduleError.
 * - Queue-side retries (5 attempts, 2–60 s backoff) cover failed deliveries.
 */
export class CloudTasksScheduler implements Scheduler {
  readonly driver = "cloudtasks";
  constructor(
    private cfg: CloudTasksConfig,
    private fetchImpl: typeof fetch = fetch,
    private now: () => number = Date.now,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  static taskId(job: ScheduledJob, retryTag?: string) {
    // Allowed: letters, digits, hyphens, underscores (max 500). Forum ids are [A-Za-z0-9_-]{1,64}.
    return `tick-${job.forumId}-${job.phaseId}-${job.atMs}${retryTag ? `-${retryTag}` : ""}`.replace(/[^A-Za-z0-9_-]/g, "_");
  }

  get queuePath() {
    return `projects/${this.cfg.project}/locations/${this.cfg.location}/queues/${this.cfg.queue}`;
  }

  async schedule(job: ScheduledJob, opts: ScheduleOptions = {}) {
    const target = `${this.cfg.baseUrl.replace(/\/$/, "")}/api/engine/tick`;
    // A small margin so the tick never lands a few ms before the deadline by the server's clock.
    const at = Math.max(job.atMs + 500, this.now());
    const task = {
      name: `${this.queuePath}/tasks/${CloudTasksScheduler.taskId(job, opts.retryTag)}`,
      scheduleTime: new Date(at).toISOString(),
      httpRequest: {
        url: target,
        httpMethod: "POST",
        headers: { "Content-Type": "application/json" },
        body: Buffer.from(JSON.stringify(job)).toString("base64"),
        oidcToken: { serviceAccountEmail: this.cfg.invokerEmail, audience: target },
      },
    };
    let last = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await this.sleep(attempt === 1 ? 300 : 1000);
      let res: Response;
      try {
        res = await this.fetchImpl(`https://cloudtasks.googleapis.com/v2/${this.queuePath}/tasks`, {
          method: "POST",
          headers: { Authorization: `Bearer ${await this.cfg.accessToken()}`, "Content-Type": "application/json" },
          body: JSON.stringify({ task }),
        });
      } catch (e) {
        last = `network: ${String(e).slice(0, 120)}`;
        continue;
      }
      if (res.ok || res.status === 409) return; // 409 ALREADY_EXISTS: this exact deadline is already queued
      last = `HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) break; // permission / bad request: retrying will not help
    }
    throw new ScheduleError(`Cloud Tasks enqueue failed: ${last}`);
  }
}

export function createScheduler(
  env: Record<string, string | undefined>,
  handler: JobHandler,
  accessToken?: () => Promise<string>,
): Scheduler {
  const driver = env.SCHEDULER_DRIVER;
  if (driver === "local") {
    if (env.VERCEL || env.NODE_ENV === "production") {
      throw new Error("SCHEDULER_DRIVER=local is not allowed in production (timers would be lost).");
    }
    return new LocalScheduler(handler);
  }
  if (driver === "cloudtasks") {
    const baseUrl = appBaseUrl(env);
    const missing = ["FIREBASE_PROJECT_ID", "CLOUD_TASKS_LOCATION", "CLOUD_TASKS_QUEUE", "CLOUD_TASKS_INVOKER_EMAIL"].filter((k) => !env[k]);
    if (missing.length || !baseUrl || !accessToken) throw new Error(`Cloud Tasks scheduler requires ${[...missing, ...(baseUrl ? [] : ["APP_BASE_URL"])].join(", ") || "a service-account credential"}.`);
    return new CloudTasksScheduler({
      project: env.FIREBASE_PROJECT_ID!,
      location: env.CLOUD_TASKS_LOCATION!,
      queue: env.CLOUD_TASKS_QUEUE!,
      invokerEmail: env.CLOUD_TASKS_INVOKER_EMAIL!,
      baseUrl,
      accessToken,
    });
  }
  throw new Error(`SCHEDULER_DRIVER must be "local" or "cloudtasks" (got ${JSON.stringify(driver)}).`);
}

/** Public base URL used for task targets and OIDC audiences (APP_BASE_URL; Vercel's production domain as fallback). */
export function appBaseUrl(env: Record<string, string | undefined>) {
  return (env.APP_BASE_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "")).replace(/\/$/, "");
}
