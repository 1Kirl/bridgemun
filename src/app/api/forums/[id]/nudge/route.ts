import { NextResponse, type NextRequest } from "next/server";
import { requireUser, withErrors } from "@/server/auth";
import { advanceIfDue, requireMember } from "@/server/forums/service";
import { getRuntime } from "@/server/runtime";

/**
 * Fallback when a scheduled tick was lost (e.g. dev server restart): any member's client may ask the
 * server to apply a deadline that has ALREADY passed by server time. Idempotent; never early.
 */
export const POST = withErrors(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const rt = getRuntime();
  await requireMember(rt.db, user, id);
  return NextResponse.json(await advanceIfDue(rt.db, id, rt.sink));
});
