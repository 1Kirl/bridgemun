import "server-only";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { apply } from "@/engine/machine";
import { toPublicState } from "@/engine/publicView";
import type { ApplyResult, CommandEnvelope, Effect, ForumEngineState } from "@/engine/types";
import { HttpError } from "@/server/auth";

/**
 * Firestore retries quota errors (RESOURCE_EXHAUSTED) silently, so a refused write used to hang every request until
 * the 120 s function timeout (production incident 2026-11-27). Fail fast with a clear 503 instead.
 */
const TX_TIMEOUT_MS = 30_000;
export function withTxTimeout<T>(p: Promise<T>): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new HttpError(503, "database_unavailable", "The database is not accepting changes right now (quota or outage). Please try again later.")), TX_TIMEOUT_MS);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

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

export type RunOptions = {
  now?: () => number;
  onEffects?: EffectSink;
  /** Extra reads/guards inside the same transaction (all reads must happen before writes). */
  beforeApply?: (tx: Transaction, state: ForumEngineState) => Promise<void>;
  /** Extra writes committed atomically with the new state (e.g. membership docs, forum status). */
  afterApply?: (tx: Transaction, prev: ForumEngineState, next: ForumEngineState) => void;
};

/** Mirror of the engine phase kept on the forum document for listings ("lobby" | "live" | "closed"). */
export function forumStatusOf(s: ForumEngineState): "lobby" | "live" | "closed" {
  return s.phase.type === "LOBBY" ? "lobby" : s.phase.type === "CLOSED" ? "closed" : "live";
}

export async function runCommand(
  db: Firestore,
  forumId: string,
  env: CommandEnvelope,
  opts: RunOptions = {},
): Promise<ApplyResult> {
  const now = opts.now ?? Date.now;
  const result = await withTxTimeout(db.runTransaction(async (tx) => {
    const ref = db.doc(statePath(forumId));
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false as const, code: "no_engine_state", message: "Forum has no engine state" };
    const state = snap.data()!.state as ForumEngineState;
    if (opts.beforeApply) await opts.beforeApply(tx, state);
    const t = now(); // server time, taken inside the attempt so retries use a fresh clock
    const r = apply(state, env, t);
    if (!r.ok || r.duplicate) return r;
    tx.set(ref, { state: plain(r.state) });
    if (forumStatusOf(state) !== forumStatusOf(r.state)) {
      tx.set(db.doc(`forums/${forumId}`), { status: forumStatusOf(r.state), statusChangedAtMs: t }, { merge: true });
    }
    opts.afterApply?.(tx, state, r.state);
    tx.set(db.doc(publicPath(forumId)), { state: plain(toPublicState(r.state)), updatedAtMs: t });
    for (const ev of r.events) tx.set(db.doc(`forums/${forumId}/events/${pad(ev.seq)}`), plain(ev));
    for (const ef of r.effects) {
      if (ef.type === "record") tx.set(db.doc(`forums/${forumId}/record/${pad(ef.entry.seq)}`), plain(ef.entry));
    }
    return r;
  }));
  if (result.ok && !result.duplicate && opts.onEffects && result.effects.length) {
    await opts.onEffects(forumId, result.effects);
  }
  return result;
}
