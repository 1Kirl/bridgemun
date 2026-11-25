import { NextResponse, type NextRequest } from "next/server";
import { requireUser, withErrors } from "@/server/auth";
import { setPresence } from "@/server/forums/service";
import { getRuntime } from "@/server/runtime";

/** Heartbeat (online) and tab-close beacon (offline). Never changes an open ballot's electorate. */
export const POST = withErrors(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { online?: unknown };
  const rt = getRuntime();
  return NextResponse.json(await setPresence(rt.db, user, id, body.online !== false, rt.sink));
});
