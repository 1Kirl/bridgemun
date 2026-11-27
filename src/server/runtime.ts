import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import type { Effect } from "@/engine/types";
import { createDummyAiDriver } from "@/server/ai/dummyDriver";
import { OpenAILlm, type LlmProvider } from "@/server/ai/llm";
import { createAiOrchestrator } from "@/server/ai/orchestrator";
import type { EffectSink } from "@/server/engine/store";
import { adminDb, getAdminApp } from "@/server/firebaseAdmin";
import { getStorage } from "firebase-admin/storage";
import { advanceIfDue } from "@/server/forums/service";
import { createScheduler, type Scheduler } from "@/server/scheduler";

/** OAuth access token of the server's service account (no extra key; used for Cloud Tasks). */
async function adminAccessToken() {
  const cred = getAdminApp().options.credential;
  if (!cred) throw new Error("no service-account credential");
  return (await cred.getAccessToken()).access_token;
}
import { FirestoreChunkAudioStore, LocalFsAudioStore, StorageAudioStore, type AudioStore } from "@/server/speech/audioStore";
import { ElevenLabsTts, MockStt, MockTts, OpenAIStt, type SttProvider, type TtsProvider } from "@/server/speech/providers";
import { readCaps, type Caps } from "@/server/usage/budget";

/**
 * Process-wide wiring: Firestore + scheduler + AI + speech providers, chosen by environment.
 *   AI_DRIVER     off | dummy (local test double) | openai
 *   TTS_PROVIDER  none | mock | elevenlabs          (needs an audio store; local only for now)
 *   STT_PROVIDER  mock | openai
 * Paid providers are never selected implicitly. Caps: see server/usage/budget.ts (CAP_* env overrides).
 */
export type Runtime = {
  /** Resolves when all background work started so far (and work it triggers) has finished. */
  drain: () => Promise<void>;
  db: Firestore;
  scheduler: Scheduler;
  sink: EffectSink;
  aiDriver: string;
  stt: SttProvider;
  audioStore: AudioStore | null;
  caps: Caps;
};

declare global {
  var __bridgemunRuntime: Runtime | undefined;
}

export type RuntimeOverrides = { llm?: LlmProvider; tts?: TtsProvider | null; stt?: SttProvider; audioStore?: AudioStore | null; delayMs?: number };

export function buildRuntime(db: Firestore, env: Record<string, string | undefined>, over: RuntimeOverrides = {}): Runtime {
  const prod = !!(env.VERCEL || env.NODE_ENV === "production");
  let sink: EffectSink = async () => {};
  const pending = new Set<Promise<unknown>>();
  const track = (p: Promise<unknown>) => {
    pending.add(p);
    void p.finally(() => pending.delete(p));
  };
  const drain = async () => {
    // Work may enqueue more work (AI action → engine effect → next AI action), so loop until quiet.
    for (let i = 0; i < 50 && pending.size; i++) await Promise.allSettled([...pending]);
  };
  const scheduler = createScheduler(
    env,
    async (job) => {
      await advanceIfDue(db, job.forumId, sink);
    },
    // Cloud Tasks calls use the server's existing service-account credential (firebase-admin; cloud-platform scope).
    env.SCHEDULER_DRIVER === "cloudtasks" ? adminAccessToken : undefined,
  );
  const caps = readCaps(env);

  // AUDIO_STORE: "local" (dev default) | "firestore" (opt-in, existing Firestore quota) | unset in production = none (captions only).
  const audioStore: AudioStore | null =
    over.audioStore !== undefined
      ? over.audioStore
      : env.AUDIO_STORE === "storage"
        ? new StorageAudioStore(getStorage(getAdminApp()).bucket())
        : env.AUDIO_STORE === "firestore"
          ? new FirestoreChunkAudioStore(db)
        : prod
          ? null
          : new LocalFsAudioStore();
  const ttsName = env.TTS_PROVIDER ?? "none";
  let tts: TtsProvider | null = null;
  if (over.tts !== undefined) tts = over.tts;
  else if (ttsName === "mock") tts = new MockTts();
  else if (ttsName === "elevenlabs") {
    if (!env.ELEVENLABS_API_KEY) throw new Error("TTS_PROVIDER=elevenlabs requires ELEVENLABS_API_KEY");
    tts = new ElevenLabsTts(env.ELEVENLABS_API_KEY);
  }
  if (tts && !audioStore) tts = null; // no place to keep audio → captions only (production storage pending D8)

  const sttName = env.STT_PROVIDER ?? "mock";
  const stt: SttProvider =
    over.stt ?? (sttName === "openai" ? new OpenAIStt(req(env, "OPENAI_API_KEY"), env.OPENAI_MODEL_TRANSCRIBE ?? "gpt-transcribe") : new MockStt());

  const aiDriverName = env.AI_DRIVER ?? "off";
  let ai: ((forumId: string, effects: Effect[]) => Promise<void>) | null = null;
  if (aiDriverName === "dummy") {
    if (prod) throw new Error("AI_DRIVER=dummy is a local test double and is not allowed in production.");
    ai = createDummyAiDriver(db, () => sink);
  } else if (aiDriverName === "openai" || over.llm) {
    const llm = over.llm ?? new OpenAILlm(req(env, "OPENAI_API_KEY"));
    ai = createAiOrchestrator(
      db,
      {
        llm,
        tts,
        audioStore,
        caps,
        models: { decision: env.OPENAI_MODEL_DECISION ?? "gpt-6.1-terra", speech: env.OPENAI_MODEL_SPEECH ?? "gpt-6.2-sol" },
        ttsModelId: env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2",
        floorConsultPerWindow: Number(env.AI_FLOOR_CONSULT_PER_WINDOW ?? 2),
        aiCooldownSec: Number(env.AI_COOLDOWN_SEC ?? 90),
        delayMs: over.delayMs ?? (prod ? 0 : 300),
        track,
      },
      () => sink,
    );
  }

  sink = async (forumId: string, effects: Effect[]) => {
    for (const e of effects) {
      if (e.type !== "schedule") continue;
      try {
        await scheduler.schedule({ forumId, phaseId: e.phaseId, atMs: e.atMs });
      } catch (err) {
        // The state change is already committed but its deadline task is missing. Flag the forum: the repair job
        // (/api/engine/repair, Cloud Scheduler) re-registers the current deadline even if every browser is closed;
        // a client nudge / presence heartbeat also applies a due deadline meanwhile.
        console.error("[scheduler] enqueue failed", forumId, e.phaseId, String(err).slice(0, 200));
        await db
          .doc(`forums/${forumId}`)
          .set({ schedulerPending: true, schedulerError: { phaseId: e.phaseId, deadlineMs: e.atMs, atMs: Date.now(), message: String(err).slice(0, 200) } }, { merge: true })
          .catch(() => {});
      }
    }
    if (ai) await ai(forumId, effects);
    // Audio retention: AI speech audio is only needed while the forum runs. When it closes, its audio objects are
    // deleted (captions stay in the record). A bucket lifecycle rule (7 days) is the backstop for anything missed.
    if (effects.some((e) => e.type === "forum_closed") && audioStore?.deleteForum) {
      await audioStore.deleteForum(forumId).catch((err) => console.error("[audio] cleanup failed", forumId, err));
    }
  };
  return { drain, db, scheduler, sink, aiDriver: over.llm ? `override:${over.llm.name}` : aiDriverName, stt, audioStore, caps };
}

function req(env: Record<string, string | undefined>, k: string) {
  const v = env[k];
  if (!v) throw new Error(`${k} is required for the selected provider`);
  return v;
}

export function getRuntime(): Runtime {
  globalThis.__bridgemunRuntime ??= buildRuntime(adminDb(), process.env);
  return globalThis.__bridgemunRuntime;
}
