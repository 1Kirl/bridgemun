import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { apply } from "@/engine/machine";
import { toPublicState } from "@/engine/publicView";
import type { ApplyResult, CommandEnvelope, Effect, ForumEngineState } from "@/engine/types";

/**
 * Firestore persistence for the engine.
 *   forums/{id}/engineState/current   full private state (server only; rules deny all client access)
 *   forums/{id}/engine/public         member-readable projection (open-ballot choices hidden)
 *   forums/{id}/events/{seq}          append-only applied-command log
 *   forums/{id}/record/{seq}          confirmed record (speeches, chair announcements) = AI context
 *
 * Every command runs in ONE transaction: read state → pure apply → write state + projection + logs.
 * Concurrent commands are serialised by Firestore's optimistic transactions (automatic retry).
 * Side effects (scheduling, AI work) run only after commit.
 */
const pad = (n: number) => String(n).padStart(9, "0");
/** Firestore rejects `undefined`; JSON round-trip also guarantees plain data. */
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const statePath = (forumId: string) => `forums/${forumId}/engineState/current`;
export const publicPath = (forumId: string) => `forums/${forumId}/engine/public`;

export async function initEngineState(db: Firestore, state: ForumEngineState) {
  await db.runTransaction(async (tx) => {
    const ref = db.doc(statePath(state.forumId));
    if ((await tx.get(ref)).exists) throw new Error("engine state already initialised");
    tx.set(ref, { state: plain(state) });
    tx.set(db.doc(publicPath(state.forumId)), { state: plain(toPublicState(state)), updatedAtMs: Date.now() });
  });
}

export async function loadState(db: Firestore, forumId: string): Promise<ForumEngineState | null> {
  const snap = await db.doc(statePath(forumId)).get();
  return snap.exists ? (snap.data()!.state as ForumEngineState) : null;
}

export type EffectSink = (forumId: string, effects: Effect[]) => Promise<void>;

export async function runCommand(
  db: Firestore,
  forumId: string,
  env: CommandEnvelope,
  opts: { now?: () => number; onEffects?: EffectSink } = {},
): Promise<ApplyResult> {
  const now = opts.now ?? Date.now;
  const result = await db.runTransaction(async (tx) => {
    const ref = db.doc(statePath(forumId));
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false as const, code: "no_engine_state", message: "Forum has no engine state" };
    const state = snap.data()!.state as ForumEngineState;
    const t = now(); // server time, taken inside the attempt so retries use a fresh clock
    const r = apply(state, env, t);
    if (!r.ok || r.duplicate) return r;
    tx.set(ref, { state: plain(r.state) });
    tx.set(db.doc(publicPath(forumId)), { state: plain(toPublicState(r.state)), updatedAtMs: t });
    for (const ev of r.events) tx.set(db.doc(`forums/${forumId}/events/${pad(ev.seq)}`), plain(ev));
    for (const ef of r.effects) {
      if (ef.type === "record") tx.set(db.doc(`forums/${forumId}/record/${pad(ef.entry.seq)}`), plain(ef.entry));
    }
    return r;
  });
  if (result.ok && !result.duplicate && opts.onEffects && result.effects.length) {
    await opts.onEffects(forumId, result.effects);
  }
  return result;
}
