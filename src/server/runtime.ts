import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import type { Effect } from "@/engine/types";
import { createDummyAiDriver } from "@/server/ai/dummyDriver";
import type { EffectSink } from "@/server/engine/store";
import { adminDb } from "@/server/firebaseAdmin";
import { advanceIfDue } from "@/server/forums/service";
import { createScheduler, type Scheduler } from "@/server/scheduler";

/**
 * Process-wide wiring: Firestore + scheduler + effect handling.
 *  - schedule effects → scheduler (local timers in dev; QStash later)
 *  - ai_* effects → AI driver (AI_DRIVER=dummy for now; "off" disables; the OpenAI driver arrives in Phase 5)
 *  - forum_closed → nothing to cancel: later ticks are no-ops for a CLOSED forum
 */
type Runtime = { db: Firestore; scheduler: Scheduler; sink: EffectSink; aiDriver: string };

declare global {
  var __bridgemunRuntime: Runtime | undefined;
}

export function buildRuntime(db: Firestore, env: Record<string, string | undefined>): Runtime {
  let sink: EffectSink = async () => {};
  const scheduler = createScheduler(env, async (job) => {
    await advanceIfDue(db, job.forumId, sink);
  });
  const aiDriverName = env.AI_DRIVER ?? "off";
  if (aiDriverName === "dummy" && (env.VERCEL || env.NODE_ENV === "production")) {
    throw new Error("AI_DRIVER=dummy is a local test double and is not allowed in production.");
  }
  const ai = aiDriverName === "dummy" ? createDummyAiDriver(db, () => sink) : null;
  sink = async (forumId: string, effects: Effect[]) => {
    for (const e of effects) {
      if (e.type === "schedule") await scheduler.schedule({ forumId, phaseId: e.phaseId, atMs: e.atMs });
    }
    if (ai) await ai(forumId, effects);
  };
  return { db, scheduler, sink, aiDriver: aiDriverName };
}

export function getRuntime(): Runtime {
  globalThis.__bridgemunRuntime ??= buildRuntime(adminDb(), process.env);
  return globalThis.__bridgemunRuntime;
}
