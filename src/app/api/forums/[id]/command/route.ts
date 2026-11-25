import { after, NextResponse, type NextRequest } from "next/server";
import { requireUser, withErrors } from "@/server/auth";
import { userCommand } from "@/server/forums/service";
import { getRuntime } from "@/server/runtime";

/** Every delegate action goes through the engine here; the server maps the user to their own seat. */
export const POST = withErrors(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { command?: unknown; expect?: unknown };
  const rt = getRuntime();
  after(() => rt.drain()); // finish AI follow-up work before the serverless function is frozen
  return NextResponse.json(await userCommand(rt.db, user, id, body, rt.sink));
});
