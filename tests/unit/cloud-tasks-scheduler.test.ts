/** Cloud Tasks driver and the OIDC gate of /api/engine/tick and /api/engine/repair (no network). */
import { describe, expect, it, vi } from "vitest";
import { CloudTasksScheduler, ScheduleError, createScheduler } from "@/server/scheduler";
import { verifyServiceOidc } from "@/server/scheduler/oidc";

const cfg = {
  project: "bridgemun",
  location: "asia-northeast3",
  queue: "engine-ticks",
  invokerEmail: "bridgemun-tasks-invoker@bridgemun.iam.gserviceaccount.com",
  baseUrl: "https://bridgemun.vercel.app/",
  accessToken: async () => "ACCESS",
};
const job = { forumId: "F0rum_1", phaseId: "p7", atMs: Date.UTC(2026, 10, 28, 1, 0, 0) };
const resp = (status: number) => new Response("{}", { status });

describe("CloudTasksScheduler", () => {
  it("creates one HTTP task at the deadline, with an OIDC token for the tick URL and a deterministic name", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const f = vi.fn(async (url: string, init: RequestInit) => (calls.push({ url, init }), resp(200)));
    await new CloudTasksScheduler(cfg, f as never, () => job.atMs - 60_000).schedule(job);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://cloudtasks.googleapis.com/v2/projects/bridgemun/locations/asia-northeast3/queues/engine-ticks/tasks");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer ACCESS");
    const { task } = JSON.parse(String(calls[0].init.body));
    expect(task.name).toBe("projects/bridgemun/locations/asia-northeast3/queues/engine-ticks/tasks/tick-F0rum_1-p7-" + job.atMs);
    expect(Date.parse(task.scheduleTime)).toBe(job.atMs + 500); // small margin after the deadline
    expect(task.httpRequest.url).toBe("https://bridgemun.vercel.app/api/engine/tick");
    expect(task.httpRequest.oidcToken).toEqual({ serviceAccountEmail: cfg.invokerEmail, audience: "https://bridgemun.vercel.app/api/engine/tick" });
    expect(JSON.parse(Buffer.from(task.httpRequest.body, "base64").toString())).toEqual(job);
  });

  it("re-registration after a lost task uses a fresh name (Cloud Tasks reserves deleted / executed names)", async () => {
    const f = vi.fn(async () => resp(200));
    await new CloudTasksScheduler(cfg, f as never, () => job.atMs - 60_000).schedule(job, { retryTag: "r123" });
    const { task } = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(task.name.endsWith(`/tasks/tick-F0rum_1-p7-${job.atMs}-r123`)).toBe(true);
    expect(JSON.parse(Buffer.from(task.httpRequest.body, "base64").toString())).toEqual(job); // body unchanged
  });

  it("a deadline already in the past is dispatched now (not in the past)", async () => {
    const f = vi.fn(async () => resp(200));
    const now = job.atMs + 10_000;
    await new CloudTasksScheduler(cfg, f as never, () => now).schedule(job);
    const { task } = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(Date.parse(task.scheduleTime)).toBe(now);
  });

  it("409 (same deadline already queued) is success — no duplicate task", async () => {
    const f = vi.fn(async () => resp(409));
    await expect(new CloudTasksScheduler(cfg, f as never).schedule(job)).resolves.toBeUndefined();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("transient errors (429/5xx/network) are retried at most twice; then ScheduleError", async () => {
    const sleep = vi.fn(async () => {});
    const ok = vi.fn().mockResolvedValueOnce(resp(503)).mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(resp(200));
    await new CloudTasksScheduler(cfg, ok as never, Date.now, sleep).schedule(job);
    expect(ok).toHaveBeenCalledTimes(3);
    const bad = vi.fn(async () => resp(429));
    await expect(new CloudTasksScheduler(cfg, bad as never, Date.now, sleep).schedule(job)).rejects.toBeInstanceOf(ScheduleError);
    expect(bad).toHaveBeenCalledTimes(3);
  });

  it("permission / request errors are not retried (fail fast, recorded by the caller)", async () => {
    const f = vi.fn(async () => resp(403));
    await expect(new CloudTasksScheduler(cfg, f as never, Date.now, async () => {}).schedule(job)).rejects.toThrow(/HTTP 403/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("factory: cloudtasks needs project, location, queue, invoker, base URL and a credential", () => {
    const env = { SCHEDULER_DRIVER: "cloudtasks", FIREBASE_PROJECT_ID: "bridgemun", CLOUD_TASKS_LOCATION: "asia-northeast3", CLOUD_TASKS_QUEUE: "engine-ticks", CLOUD_TASKS_INVOKER_EMAIL: cfg.invokerEmail, APP_BASE_URL: "https://x.example" };
    expect(createScheduler(env, async () => {}, async () => "t").driver).toBe("cloudtasks");
    expect(() => createScheduler(env, async () => {})).toThrow(/credential/);
    expect(() => createScheduler({ ...env, CLOUD_TASKS_INVOKER_EMAIL: "" }, async () => {}, async () => "t")).toThrow(/CLOUD_TASKS_INVOKER_EMAIL/);
  });
});

describe("OIDC gate (tick / repair)", () => {
  const aud = "https://bridgemun.vercel.app/api/engine/tick";
  const good = async () => ({ iss: "https://accounts.google.com", email: cfg.invokerEmail, email_verified: true });
  it("accepts only a Google-signed token for this audience from the invoker service account", async () => {
    expect(await verifyServiceOidc("Bearer a.b.c", aud, cfg.invokerEmail, good)).toEqual({ ok: true });
  });
  it("rejects: no token, invalid/expired/wrong-audience token, wrong issuer, other identity, unverified e-mail", async () => {
    expect(await verifyServiceOidc(null, aud, cfg.invokerEmail, good)).toMatchObject({ ok: false, reason: "missing_bearer_token" });
    expect(await verifyServiceOidc("Basic xyz", aud, cfg.invokerEmail, good)).toMatchObject({ ok: false });
    const throws = async () => {
      throw new Error("Wrong recipient, payload audience != requiredAudience");
    };
    expect(await verifyServiceOidc("Bearer a.b.c", aud, cfg.invokerEmail, throws)).toMatchObject({ ok: false, reason: "invalid_token" });
    expect(await verifyServiceOidc("Bearer a.b.c", aud, cfg.invokerEmail, async () => ({ iss: "https://evil.example", email: cfg.invokerEmail, email_verified: true }))).toMatchObject({ reason: "wrong_issuer" });
    expect(await verifyServiceOidc("Bearer a.b.c", aud, cfg.invokerEmail, async () => ({ iss: "accounts.google.com", email: "someone@else.iam.gserviceaccount.com", email_verified: true }))).toMatchObject({ reason: "wrong_identity" });
    expect(await verifyServiceOidc("Bearer a.b.c", aud, cfg.invokerEmail, async () => ({ iss: "accounts.google.com", email: cfg.invokerEmail, email_verified: false }))).toMatchObject({ reason: "wrong_identity" });
    expect(await verifyServiceOidc("Bearer a.b.c", aud, "", good)).toMatchObject({ reason: "wrong_identity" });
  });
});
