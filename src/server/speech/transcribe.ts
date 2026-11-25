import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { HttpError, type AuthedUser } from "@/server/auth";
import { loadState, runCommand, type EffectSink } from "@/server/engine/store";
import { requireMember } from "@/server/forums/service";
import type { SttProvider } from "@/server/speech/providers";
import { BudgetExceeded, reserve, type Caps } from "@/server/usage/budget";

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav"];
/** OpenAI infers the format from the file extension (found in a real run: ".mpeg" was rejected, ".mp3" works). */
const EXT: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav" };

/**
 * Speaker's own recording → transcript draft → engine `transcript_result` (system command).
 * Only the delegate whose speech is awaiting confirmation may upload; the transcript enters the record
 * (and AI context) only after confirmation / auto-confirm in the engine's SPEECH_CONFIRM phase.
 * Raw audio is not stored.
 */
export async function transcribeSpeech(
  db: Firestore,
  user: AuthedUser,
  forumId: string,
  input: { audio: Uint8Array; mime: string; claimedSeconds: number },
  deps: { stt: SttProvider; caps: Caps; sink?: EffectSink },
) {
  const m = await requireMember(db, user, forumId);
  const s = await loadState(db, forumId);
  if (!s) throw new HttpError(404, "forum_not_found");
  const p = s.phase;
  if (p.type !== "SPEECH_CONFIRM" || p.seat !== m.countryCode) throw new HttpError(409, "not_awaiting_your_transcript");
  if (p.transcript.status !== "pending") return { ok: true, status: p.transcript.status, duplicate: true };
  const mime = input.mime.split(";")[0].trim();
  if (!ALLOWED.includes(mime)) throw new HttpError(415, "unsupported_audio");
  if (input.audio.byteLength > MAX_AUDIO_BYTES) throw new HttpError(413, "audio_too_large");
  const seconds = Math.max(1, Math.min(Math.ceil(input.claimedSeconds || 0), s.speakingTimeSec + 15));
  let result: { ok: true; text: string } | { ok: false; error: string };
  try {
    await reserve(db, forumId, { stt_seconds: seconds }, deps.caps);
    result = await deps.stt.transcribe({
      audio: input.audio,
      mime,
      filename: `speech.${EXT[mime] ?? "webm"}`,
      prompt: `Model UN committee speech by the delegation of ${s.seats[m.countryCode].countryName}.`,
    });
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) throw e;
    result = { ok: false, error: e.message };
  }
  const r = await runCommand(
    db,
    forumId,
    { actor: { kind: "system" }, command: { type: "transcript_result", seat: m.countryCode, ok: result.ok, text: result.ok ? result.text : undefined }, expect: { phaseId: s.phaseId } },
    { onEffects: deps.sink },
  );
  return { ok: r.ok, status: result.ok ? "ready" : "failed", provider: deps.stt.name, error: result.ok ? undefined : result.error };
}
