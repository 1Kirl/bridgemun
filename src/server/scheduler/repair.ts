import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { phaseDeadline } from "@/engine/machine";
import { advanceIfDue } from "@/server/forums/service";
import { loadState } from "@/server/engine/store";
import type { EffectSink } from "@/server/engine/store";
import type { Scheduler } from "@/server/scheduler";

/** When the forum next needs the server: the hold's close time while on hold, else the current step's deadline. */
export function nextWakeMs(s: { paused: { autoResumeAtMs: number } | null; phase: Parameters<typeof phaseDeadline>[0] }) {
  return s.paused ? s.paused.autoResumeAtMs : phaseDeadline(s.phase);
}

/**
 * Re-arms forums whose deadline task could not be registered (flag `schedulerPending`, set by the runtime sink).
 * Only flagged forums are read — this never scans every meeting and never replaces per-deadline tasks.
 * Overdue → applied now (which schedules the next deadline); future → registered again (same task name = no-op
 * if it exists). The flag is cleared only after success; failures stay flagged with an attempt count.
 */
export async function repairPendingSchedules(db: Firestore, scheduler: Scheduler, sink: EffectSink, now: () => number = Date.now, limit = 25) {
  const snap = await db.collection("forums").where("schedulerPending", "==", true).limit(limit).get();
  const out: Array<{ forumId: string; result: string }> = [];
  for (const doc of snap.docs) {
    const forumId = doc.id;
    try {
      const s = await loadState(db, forumId);
      const wake = s && s.phase.type !== "CLOSED" ? nextWakeMs(s) : null;
      let result: string;
      if (wake === null) result = "nothing_to_schedule";
      else if (wake <= now()) result = `applied:${(await advanceIfDue(db, forumId, sink, now)).reason}`;
      else {
        await scheduler.schedule({ forumId, phaseId: s!.phaseId, atMs: wake });
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
  return out;
}
