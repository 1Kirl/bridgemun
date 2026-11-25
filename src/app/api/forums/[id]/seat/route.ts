import { NextResponse, type NextRequest } from "next/server";
import { requireUser, withErrors } from "@/server/auth";
import { claimSeat } from "@/server/forums/service";
import { getRuntime } from "@/server/runtime";

/** Join step 2: claim a seat (replacing its AI) atomically; existing members get their seat back. */
export const POST = withErrors(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { code?: unknown; seat?: unknown };
  const rt = getRuntime();
  return NextResponse.json(await claimSeat(rt.db, user, id, body, rt.sink));
});
