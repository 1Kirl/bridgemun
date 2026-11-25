import { NextResponse, type NextRequest } from "next/server";
import { requireUser, withErrors } from "@/server/auth";
import { createForum } from "@/server/forums/service";
import { getRuntime } from "@/server/runtime";

/** Create a forum: owner seat, AI seats for every other country, join code, engine state — one transaction. */
export const POST = withErrors(async (req: NextRequest) => {
  const user = await requireUser(req);
  const body = await req.json().catch(() => ({}));
  const out = await createForum(getRuntime().db, user, body);
  return NextResponse.json(out, { status: 201 });
});
