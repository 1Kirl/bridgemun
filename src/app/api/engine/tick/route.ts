import { after, NextResponse, type NextRequest } from "next/server";
import { HttpError, withErrors } from "@/server/auth";
import { advanceIfDue } from "@/server/forums/service";
import { getRuntime } from "@/server/runtime";
import { verifyQstashSignature } from "@/server/scheduler/qstashVerify";

/**
 * QStash scheduler callback. Enabled only with SCHEDULER_DRIVER=qstash, APP_BASE_URL and both signing
 * keys; every request must carry a valid Upstash signature for exactly this URL and body. It can only
 * apply a deadline that has already passed by server time (same idempotent path as everything else).
 */
export const POST = withErrors(async (req: NextRequest) => {
  const env = process.env;
  const base = env.APP_BASE_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  if (env.SCHEDULER_DRIVER !== "qstash" || !base || !env.QSTASH_CURRENT_SIGNING_KEY || !env.QSTASH_NEXT_SIGNING_KEY) {
    throw new HttpError(404, "not_enabled");
  }
  const body = await req.text();
  const url = `${base.replace(/\/$/, "")}/api/engine/tick`;
  const v = verifyQstashSignature({
    signature: req.headers.get("upstash-signature"),
    body,
    url,
    keys: [env.QSTASH_CURRENT_SIGNING_KEY, env.QSTASH_NEXT_SIGNING_KEY],
  });
  if (!v.ok) throw new HttpError(401, "bad_signature", v.reason);
  const job = JSON.parse(body || "{}") as { forumId?: string };
  if (!job.forumId || !/^[A-Za-z0-9_-]{1,64}$/.test(job.forumId)) throw new HttpError(400, "bad_job");
  const rt = getRuntime();
  after(() => rt.drain()); // finish AI follow-up work before the serverless function is frozen
  return NextResponse.json(await advanceIfDue(rt.db, job.forumId, rt.sink));
});
