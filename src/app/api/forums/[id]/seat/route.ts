import { after, NextResponse, type NextRequest } from "next/server";
import { requireUser, withErrors } from "@/server/auth";
import { claimSeat } from "@/server/forums/service";
import { getRuntime } from "@/server/runtime";

/** AI follow-up work runs in after(); bounded so a stuck provider cannot hold the function (engine deadlines recover). */
export const maxDuration = 120;

/** Join step 2: claim a seat (replacing its AI) atomically; existing members get their seat back. */
export const POST = withErrors(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { code?: unknown; seat?: unknown };
  const rt = getRuntime();
  after(() => rt.drain()); // finish AI follow-up work before the serverless function is frozen
  return NextResponse.json(await claimSeat(rt.db, user, id, body, rt.sink));
});
