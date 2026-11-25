import { type NextRequest } from "next/server";
import { HttpError, requireUser, withErrors } from "@/server/auth";
import { requireMember } from "@/server/forums/service";
import { getRuntime } from "@/server/runtime";

/** AI speech audio, members only (fetched with the ID token, played from a blob URL). */
export const GET = withErrors(async (req: NextRequest, ctx: { params: Promise<{ id: string; audioId: string }> }) => {
  const user = await requireUser(req);
  const { id, audioId } = await ctx.params;
  const rt = getRuntime();
  await requireMember(rt.db, user, id);
  if (!rt.audioStore) throw new HttpError(404, "audio_store_not_configured");
  const a = await rt.audioStore.get(id, audioId);
  if (!a) throw new HttpError(404, "audio_not_found");
  return new Response(a.bytes as BodyInit, { headers: { "Content-Type": a.mime, "Cache-Control": "private, max-age=3600" } });
});
