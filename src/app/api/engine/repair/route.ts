import { after, NextResponse, type NextRequest } from "next/server";
import { HttpError, withErrors } from "@/server/auth";
import { getRuntime } from "@/server/runtime";
import { appBaseUrl } from "@/server/scheduler";
import { verifyServiceOidc } from "@/server/scheduler/oidc";
import { repairPendingSchedules } from "@/server/scheduler/repair";

export const maxDuration = 60;

/**
 * Recovery for deadlines whose Cloud Tasks registration failed (Cloud Scheduler job "engine-repair", every 5 min,
 * OIDC from the invoker service account). Reads only forums flagged `schedulerPending`.
 */
export const POST = withErrors(async (req: NextRequest) => {
  const env = process.env;
  const base = appBaseUrl(env);
  if (env.SCHEDULER_DRIVER !== "cloudtasks" || !base || !env.CLOUD_TASKS_INVOKER_EMAIL) throw new HttpError(404, "not_enabled");
  const v = await verifyServiceOidc(req.headers.get("authorization"), `${base}/api/engine/repair`, env.CLOUD_TASKS_INVOKER_EMAIL);
  if (!v.ok) throw new HttpError(401, "unauthorized", v.reason);
  const rt = getRuntime();
  after(() => rt.drain());
  const repaired = await repairPendingSchedules(rt.db, rt.scheduler, rt.sink);
  if (repaired.length) console.log("[repair]", JSON.stringify(repaired));
  return NextResponse.json({ repaired });
});
