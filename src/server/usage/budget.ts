import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";

/**
 * Hard caps on paid external usage. Every OpenAI / ElevenLabs call must reserve budget first;
 * when a cap would be exceeded the call is NOT made (the meeting continues without it).
 *   forums/{id}/usage/ai        per-forum counters
 *   usage_global/{YYYY-MM-DD}   per-day counters across all forums (server only; rules deny)
 */
export type UsageKind = "llm_calls" | "llm_tokens" | "stt_seconds" | "tts_chars";
export type Caps = { perForum: Record<UsageKind, number>; perDay: Record<UsageKind, number> };

export const DEFAULT_CAPS: Caps = {
  // One 60-minute forum with ~6 AI seats: ~40 AI speeches, ~30 votes, ~40 floor windows (≈2 AI calls each)
  // → ≈ 200 calls. Caps leave headroom but stop runaway loops.
  perForum: { llm_calls: 300, llm_tokens: 600_000, stt_seconds: 1_800, tts_chars: 40_000 },
  perDay: { llm_calls: 1_500, llm_tokens: 3_000_000, stt_seconds: 7_200, tts_chars: 150_000 },
};

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export function readCaps(env: Record<string, string | undefined>): Caps {
  const k = (kind: UsageKind) => kind.toUpperCase();
  const perForum = { ...DEFAULT_CAPS.perForum };
  const perDay = { ...DEFAULT_CAPS.perDay };
  for (const kind of Object.keys(perForum) as UsageKind[]) {
    perForum[kind] = num(env[`CAP_FORUM_${k(kind)}`], perForum[kind]);
    perDay[kind] = num(env[`CAP_DAY_${k(kind)}`], perDay[kind]);
  }
  return { perForum, perDay };
}

export class BudgetExceeded extends Error {
  constructor(public kind: UsageKind, public scope: "forum" | "day") {
    super(`budget exceeded: ${kind} (${scope})`);
  }
}

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Atomically checks both caps and records the reservation. Throws BudgetExceeded (no partial write). */
export async function reserve(
  db: Firestore,
  forumId: string,
  amounts: Partial<Record<UsageKind, number>>,
  caps: Caps,
  now = Date.now(),
): Promise<void> {
  const fRef = db.doc(`forums/${forumId}/usage/ai`);
  const dRef = db.doc(`usage_global/${dayKey(now)}`);
  await db.runTransaction(async (tx) => {
    const [f, d, forum] = await Promise.all([tx.get(fRef), tx.get(dRef), tx.get(db.doc(`forums/${forumId}`))]);
    if (!forum.exists) throw new BudgetExceeded("llm_calls", "forum"); // forum deleted: no new AI work, nothing written
    const fu = (f.data() ?? {}) as Partial<Record<UsageKind, number>>;
    const du = (d.data() ?? {}) as Partial<Record<UsageKind, number>>;
    for (const [kind, amt] of Object.entries(amounts) as Array<[UsageKind, number]>) {
      if ((fu[kind] ?? 0) + amt > caps.perForum[kind]) throw new BudgetExceeded(kind, "forum");
      if ((du[kind] ?? 0) + amt > caps.perDay[kind]) throw new BudgetExceeded(kind, "day");
    }
    const inc = Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, FieldValue.increment(v as number)]));
    tx.set(fRef, { ...inc, updatedAtMs: now }, { merge: true });
    tx.set(dRef, { ...inc, updatedAtMs: now }, { merge: true });
  });
}

/** Records the difference between reserved and actual usage (e.g. real token counts). Never blocks. */
export async function settle(db: Firestore, forumId: string, delta: Partial<Record<UsageKind, number>>, now = Date.now()) {
  const inc = Object.fromEntries(Object.entries(delta).filter(([, v]) => v).map(([k, v]) => [k, FieldValue.increment(v as number)]));
  if (!Object.keys(inc).length) return;
  if (!(await db.doc(`forums/${forumId}`).get()).exists) return; // forum deleted meanwhile: write nothing under it
  await Promise.all([
    db.doc(`forums/${forumId}/usage/ai`).set(inc, { merge: true }),
    db.doc(`usage_global/${dayKey(now)}`).set(inc, { merge: true }),
  ]);
}

export async function readUsage(db: Firestore, forumId: string) {
  return ((await db.doc(`forums/${forumId}/usage/ai`).get()).data() ?? {}) as Partial<Record<UsageKind, number>>;
}
