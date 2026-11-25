import { NextResponse, type NextRequest } from "next/server";
import { requireUser, withErrors } from "@/server/auth";
import { lookupByCode } from "@/server/forums/service";
import { getRuntime } from "@/server/runtime";

/** Join step 1: code → forum summary and seat list (refused for non-members once started). */
export const POST = withErrors(async (req: NextRequest) => {
  const user = await requireUser(req);
  const body = (await req.json().catch(() => ({}))) as { code?: string };
  return NextResponse.json(await lookupByCode(getRuntime().db, user, body.code ?? ""));
});
