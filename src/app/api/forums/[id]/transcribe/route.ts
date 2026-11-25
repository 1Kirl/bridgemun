import { NextResponse, type NextRequest } from "next/server";
import { HttpError, requireUser, withErrors } from "@/server/auth";
import { getRuntime } from "@/server/runtime";
import { MAX_AUDIO_BYTES, transcribeSpeech } from "@/server/speech/transcribe";

/** Upload of the speaker's own recording (multipart: audio, seconds). Mock or OpenAI per STT_PROVIDER. */
export const POST = withErrors(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_AUDIO_BYTES + 64_000) throw new HttpError(413, "audio_too_large");
  const form = await req.formData();
  const file = form.get("audio");
  if (!(file instanceof Blob)) throw new HttpError(400, "audio_missing");
  const rt = getRuntime();
  const out = await transcribeSpeech(
    rt.db,
    user,
    id,
    { audio: new Uint8Array(await file.arrayBuffer()), mime: file.type || "audio/webm", claimedSeconds: Number(form.get("seconds") ?? 0) },
    { stt: rt.stt, caps: rt.caps, sink: rt.sink },
  );
  return NextResponse.json(out);
});
