import { after, NextResponse, type NextRequest } from "next/server";
import { HttpError, withErrors } from "@/server/auth";
import { advanceIfDue } from "@/server/forums/service";
import { getRuntime } from "@/server/runtime";
import { appBaseUrl } from "@/server/scheduler";
import { verifyServiceOidc } from "@/server/scheduler/oidc";

/** AI follow-up work runs in after(); bounded so a stuck provider cannot hold the function (engine deadlines recover). */
export const maxDuration = 120;

/**
 * Cloud Tasks callback (one task per deadline). Accepted only with SCHEDULER_DRIVER=cloudtasks and a valid
 * Google-signed OIDC token for exactly this URL from the configured invoker service account. It can only apply
 * a deadline that has passed by server time (the same idempotent path as everything else): duplicate, stale
 * (phase moved on) and closed/deleted-forum ticks are no-ops answered with 200 so Cloud Tasks does not retry them.
 */
export const POST = withErrors(async (req: NextRequest) => {
  const env = process.env;
  const base = appBaseUrl(env);
  if (env.SCHEDULER_DRIVER !== "cloudtasks" || !base || !env.CLOUD_TASKS_INVOKER_EMAIL) throw new HttpError(404, "not_enabled");
  const v = await verifyServiceOidc(req.headers.get("authorization"), `${base}/api/engine/tick`, env.CLOUD_TASKS_INVOKER_EMAIL);
  if (!v.ok) throw new HttpError(401, "unauthorized", v.reason);
  const job = (await req.json().catch(() => ({}))) as { forumId?: string; atMs?: number };
  if (!job.forumId || !/^[A-Za-z0-9_-]{1,64}$/.test(job.forumId)) throw new HttpError(400, "bad_job");
  const rt = getRuntime();
  after(() => rt.drain()); // finish AI follow-up work before the serverless function is frozen
  let r = await advanceIfDue(rt.db, job.forumId, rt.sink);
  // Clock skew guard: a task delivered a moment before the deadline by this server's clock waits briefly once
  // instead of being dropped (later deadlines have their own task).
  if (r.reason === "not_due" && typeof job.atMs === "number" && job.atMs - Date.now() <= 5000) {
    await new Promise((res) => setTimeout(res, Math.max(0, job.atMs! - Date.now()) + 100));
    r = await advanceIfDue(rt.db, job.forumId, rt.sink);
  }
  console.log("[tick]", job.forumId, r.reason); // no tokens or payload secrets
  return NextResponse.json(r);
});
