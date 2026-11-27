/** Recovery when a deadline task could not be registered: only flagged forums, re-arm or apply, flag cleared on success. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { initEngineState, loadState, runCommand } from "@/server/engine/store";
import { phaseDeadline } from "@/engine/machine";
import type { ScheduledJob, Scheduler } from "@/server/scheduler";
import { nextWakeMs, repairPendingSchedules } from "@/server/scheduler/repair";
import { human, makeState, seats, T0 } from "@/engine/__tests__/helpers";

const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

describe.skipIf(!onEmulator)("scheduler repair (Firestore emulator)", () => {
  let app: App;
  let db: Firestore;
  let n = 0;
  let forumId = "";
  const clock = { t: T0 };
  const now = () => clock.t;
  const queued: ScheduledJob[] = [];
  const ok: Scheduler = { driver: "test", schedule: async (j) => void queued.push(j) };
  const broken: Scheduler = { driver: "test", schedule: async () => { throw new Error("Cloud Tasks enqueue failed: HTTP 503"); } };

  beforeEach(async () => {
    app ??= initializeApp({ projectId: "demo-bridgemun-repair" }, "scheduler-repair-test");
    db ??= getFirestore(app);
    // only this test's forums carry the flag
    for (const d of (await db.collection("forums").where("schedulerPending", "==", true).get()).docs) await d.ref.delete();
    forumId = `r${Date.now()}_${n++}`;
    const state = makeState(seats([["us", "human", "owner"], ["gb", "human", "u2"], ["fr", "ai"]]));
    state.forumId = forumId;
    await initEngineState(db, state);
    clock.t = T0;
    await runCommand(db, forumId, { actor: human("owner"), command: { type: "start" } }, { now });
    queued.length = 0;
    await db.doc(`forums/${forumId}`).set({ schedulerPending: true, schedulerError: { phaseId: "p1", atMs: 1, message: "Cloud Tasks enqueue failed: HTTP 503" } }, { merge: true });
  });
  afterAll(async () => {
    if (app) await deleteApp(app);
  });

  it("future deadline → registered again with the current phase and deadline; flag cleared", async () => {
    const s = (await loadState(db, forumId))!;
    const r = await repairPendingSchedules(db, ok, async () => {}, now);
    expect(r).toEqual([{ forumId, result: "rescheduled" }]);
    expect(queued).toEqual([{ forumId, phaseId: s.phaseId, atMs: phaseDeadline(s.phase) }]);
    expect((await db.doc(`forums/${forumId}`).get()).data()?.schedulerPending).toBeUndefined();
  });

  it("overdue deadline → applied now (the step advances exactly once); flag cleared", async () => {
    const s = (await loadState(db, forumId))!;
    clock.t = nextWakeMs(s)! + 1000;
    const r = await repairPendingSchedules(db, ok, async () => {}, now);
    expect(r[0].result).toBe("applied:advanced");
    expect((await loadState(db, forumId))!.phaseId).not.toBe(s.phaseId);
    const again = await repairPendingSchedules(db, ok, async () => {}, now);
    expect(again).toEqual([]); // flag gone: nothing re-applied
  });

  it("queue still failing → flag kept with an attempt count (retried on the next run, no silent success)", async () => {
    const r = await repairPendingSchedules(db, broken, async () => {}, now);
    expect(r[0].result).toMatch(/^failed:/);
    const d = (await db.doc(`forums/${forumId}`).get()).data()!;
    expect(d.schedulerPending).toBe(true);
    expect(d.schedulerRepairAttempts).toBe(1);
  });

  it("closed forum → nothing to schedule; flag cleared", async () => {
    await db.doc(`forums/${forumId}/engineState/current`).update({ "state.phase": { type: "CLOSED", reason: "adjourned" } });
    const r = await repairPendingSchedules(db, ok, async () => {}, now);
    expect(r).toEqual([{ forumId, result: "nothing_to_schedule" }]);
    expect(queued).toEqual([]);
  });
});
