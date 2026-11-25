import { after, NextResponse, type NextRequest } from "next/server";
import { requireUser, withErrors } from "@/server/auth";
import { setPresence } from "@/server/forums/service";
import { getRuntime } from "@/server/runtime";

/** AI follow-up work runs in after(); bounded so a stuck provider cannot hold the function (engine deadlines recover). */
export const maxDuration = 120;

/** Heartbeat (online) and tab-close beacon (offline). Never changes an open ballot's electorate. */
export const POST = withErrors(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { online?: unknown };
  const rt = getRuntime();
  after(() => rt.drain()); // finish AI follow-up work before the serverless function is frozen
  return NextResponse.json(await setPresence(rt.db, user, id, body.online !== false, rt.sink));
});
