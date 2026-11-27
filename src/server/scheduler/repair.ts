import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { advanceIfDue } from "@/server/forums/service";
import { loadState, nextWakeMs } from "@/server/engine/store";
import type { EffectSink } from "@/server/engine/store";
import type { Scheduler } from "@/server/scheduler";

export { nextWakeMs };

/** A deadline this long past without a tick counts as lost (queue retries exhausted, task deleted, …). */
export const OVERDUE_GRACE_MS = 120_000;

/**
 * Recovery path of the deadline scheduler (Cloud Scheduler job "engine-repair", every 5 min). Never scans every
 * meeting; it reads only
 *  1. forums flagged `schedulerPending` (registration failed: set by the runtime sink), and
 *  2. forums whose stored `nextWakeAtMs` is more than OVERDUE_GRACE_MS in the past (index query) — a task that was
 *     registered but never delivered (retries exhausted, queue purged, task deleted).
 * Overdue → applied now (which registers the next deadline); future → registered again under a fresh task name
 * (`retryTag`), because Cloud Tasks keeps a deleted or executed task's name reserved and would answer 409.
 * The flag is cleared only after success; failures stay flagged with an attempt count.
 */
export async function repairPendingSchedules(db: Firestore, scheduler: Scheduler, sink: EffectSink, now: () => number = Date.now, limit = 25) {
  const out: Array<{ forumId: string; result: string }> = [];
  const snap = await db.collection("forums").where("schedulerPending", "==", true).limit(limit).get();
  for (const doc of snap.docs) {
    const forumId = doc.id;
    try {
      const s = await loadState(db, forumId);
      const wake = s ? nextWakeMs(s) : null;
      let result: string;
      if (wake === null) result = "nothing_to_schedule";
      else if (wake <= now()) result = `applied:${(await advanceIfDue(db, forumId, sink, now)).reason}`;
      else {
        await scheduler.schedule({ forumId, phaseId: s!.phaseId, atMs: wake }, { retryTag: `r${now()}` });
        result = "rescheduled";
      }
      // If applying the deadline itself failed to schedule the next one, the sink has set the flag again.
      const again = (await doc.ref.get()).data()?.schedulerError?.atMs ?? 0;
      if (again <= (doc.data().schedulerError?.atMs ?? 0)) await doc.ref.update({ schedulerPending: FieldValue.delete(), schedulerRepairedAtMs: Date.now() });
      out.push({ forumId, result });
    } catch (e) {
      await doc.ref.update({ schedulerRepairAttempts: FieldValue.increment(1), schedulerRepairError: String(e).slice(0, 200) }).catch(() => {});
      out.push({ forumId, result: `failed:${String(e).slice(0, 80)}` });
    }
  }
  const seen = new Set(out.map((o) => o.forumId));
  let overdue;
  try {
    overdue = await db.collectionGroup("engineState").where("nextWakeAtMs", "<=", now() - OVERDUE_GRACE_MS).limit(limit).get();
  } catch (e) {
    // e.g. the collection-group index is still building: the flagged forums above are still repaired
    out.push({ forumId: "-", result: `overdue_query_failed:${String(e).slice(0, 80)}` });
    return out;
  }
  for (const doc of overdue.docs) {
    const forumId = doc.ref.parent.parent?.id;
    if (!forumId || seen.has(forumId)) continue;
    try {
      const r = await advanceIfDue(db, forumId, sink, now);
      // A tick that changes nothing would match again every run: clear the marker unless the state moved meanwhile.
      if (!r.advanced) {
        const old = doc.data().nextWakeAtMs;
        await db.runTransaction(async (tx) => {
          const cur = await tx.get(doc.ref);
          if (cur.data()?.nextWakeAtMs === old) tx.update(doc.ref, { nextWakeAtMs: null, nextWakeClearedAtMs: Date.now() });
        });
      }
      out.push({ forumId, result: `overdue:${r.reason}` });
    } catch (e) {
      out.push({ forumId, result: `failed:${String(e).slice(0, 80)}` });
    }
  }
  return out;
}
