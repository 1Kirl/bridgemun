import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { initEngineState, loadState, publicPath, runCommand } from "@/server/engine/store";
import { LocalScheduler, createScheduler, type ScheduledJob } from "@/server/scheduler";
import type { Effect, Phase } from "@/engine/types";
import { ai, human, makeState, seats, system, T0 } from "@/engine/__tests__/helpers";

const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

describe.skipIf(!onEmulator)("engine store on Firestore emulator", () => {
  let app: App;
  let db: Firestore;
  let n = 0;
  let forumId = "";

  beforeEach(async () => {
    app ??= initializeApp({ projectId: "demo-bridgemun-store" }, "engine-store-test");
    db ??= getFirestore(app);
    forumId = `f${Date.now()}_${n++}`;
    const state = makeState(seats([["us", "human", "owner"], ["gb", "human", "u2"], ["fr", "ai"], ["de", "ai"], ["jp", "ai"]]));
    state.forumId = forumId;
    await initEngineState(db, state);
  });
  afterAll(async () => {
    if (app) await deleteApp(app);
  });

  let clock = T0;
  const now = () => clock;

  async function toOpenVote() {
    clock = T0;
    await runCommand(db, forumId, { actor: human("owner"), command: { type: "start" } }, { now });
    for (const id of ["fr", "de", "jp"]) await runCommand(db, forumId, { actor: ai(id), command: { type: "declare_attendance", seat: id, value: "present" } }, { now });
    await runCommand(db, forumId, { actor: human("owner"), command: { type: "declare_attendance", seat: "us", value: "present" } }, { now });
    await runCommand(db, forumId, { actor: human("u2"), command: { type: "declare_attendance", seat: "gb", value: "present" } }, { now });
    await runCommand(db, forumId, { actor: ai("fr"), command: { type: "submit_motion", seat: "fr", params: { type: "unmod_caucus", totalSec: 300 } } }, { now });
    let s = (await loadState(db, forumId))!;
    clock = (s.phase as { deadlineMs: number }).deadlineMs;
    await runCommand(db, forumId, { actor: system, command: { type: "tick" }, expect: { phaseId: s.phaseId } }, { now });
    s = (await loadState(db, forumId))!;
    clock = (s.phase as { deadlineMs: number }).deadlineMs;
    await runCommand(db, forumId, { actor: system, command: { type: "tick" }, expect: { phaseId: s.phaseId } }, { now });
    s = (await loadState(db, forumId))!;
    expect(s.phase).toMatchObject({ type: "MOTION_VOTE", stage: "voting" });
    return s;
  }

  it("concurrent votes from five seats are all applied exactly once (transactions serialise)", async () => {
    const s = await toOpenVote();
    const ballotId = (s.phase as Extract<Phase, { type: "MOTION_VOTE" }>).ballotId;
    const voters: Array<[string, ReturnType<typeof human> | ReturnType<typeof ai>]> = [
      ["us", human("owner")], ["gb", human("u2")], ["fr", ai("fr")], ["de", ai("de")], ["jp", ai("jp")],
    ];
    const results = await Promise.all(
      voters.map(([seat, actor]) =>
        runCommand(db, forumId, { actor, command: { type: "cast_vote", seat, ballotId, choice: "yes" }, expect: { ballotId } }, { now }),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    const after = (await loadState(db, forumId))!;
    expect(after.ballots[ballotId].result).toMatchObject({ yes: 5, no: 0, passed: true });
    expect(after.phase.type).toBe("UNMOD_CAUCUS"); // early close happened once all five voted
    // re-delivery of a vote is a no-op
    const dup = await runCommand(db, forumId, { actor: ai("fr"), command: { type: "cast_vote", seat: "fr", ballotId, choice: "yes" } }, { now });
    expect(dup.ok && !dup.duplicate).toBe(false);
    const events = await db.collection(`forums/${forumId}/events`).get();
    expect(events.size).toBe(after.eventSeq);
  });

  it("stale and early ticks never advance the meeting", async () => {
    const s = await toOpenVote();
    const stale = await runCommand(db, forumId, { actor: system, command: { type: "tick" }, expect: { phaseId: "p1" } }, { now });
    expect(stale).toMatchObject({ ok: false, stale: true });
    const early = await runCommand(db, forumId, { actor: system, command: { type: "tick" }, expect: { phaseId: s.phaseId } }, { now });
    expect(early).toMatchObject({ ok: true, duplicate: true });
    expect((await loadState(db, forumId))!.phaseId).toBe(s.phaseId);
  });

  it("public projection hides choices on open ballots and records are persisted", async () => {
    const s = await toOpenVote();
    const ballotId = (s.phase as Extract<Phase, { type: "MOTION_VOTE" }>).ballotId;
    await runCommand(db, forumId, { actor: human("u2"), command: { type: "cast_vote", seat: "gb", ballotId, choice: "no" } }, { now });
    const pub = (await db.doc(publicPath(forumId)).get()).data()!.state;
    expect(pub.ballots[ballotId].votes).toBeNull();
    expect(pub.ballots[ballotId].voted).toEqual(["gb"]);
    const rec = await db.collection(`forums/${forumId}/record`).get();
    expect(rec.size).toBeGreaterThan(0); // roll call record
  });

  it("local scheduler + store advance deadlines without any client", async () => {
    clock = T0;
    const scheduled: ScheduledJob[] = [];
    const handler = async (job: ScheduledJob) => {
      clock = Math.max(clock, job.atMs);
      await runCommand(db, forumId, { actor: system, command: { type: "tick" }, expect: { phaseId: job.phaseId } }, { now, onEffects: sink });
    };
    const scheduler = new LocalScheduler(handler, () => clock + 10_000_000); // fire immediately in test
    const sink = async (_f: string, effects: Effect[]) => {
      for (const e of effects) if (e.type === "schedule") {
        scheduled.push({ forumId, phaseId: e.phaseId, atMs: e.atMs });
        await scheduler.schedule({ forumId, phaseId: e.phaseId, atMs: e.atMs });
      }
    };
    await runCommand(db, forumId, { actor: human("owner"), command: { type: "start" } }, { now, onEffects: sink });
    for (const id of ["fr", "de", "jp"]) await runCommand(db, forumId, { actor: ai(id), command: { type: "declare_attendance", seat: id, value: "present" } }, { now, onEffects: sink });
    // humans never answer roll call; only the scheduler moves the meeting on
    await new Promise((r) => setTimeout(r, 400));
    scheduler.cancelAll();
    const s = (await loadState(db, forumId))!;
    expect(scheduled.length).toBeGreaterThan(1);
    expect(s.phase.type).not.toBe("ROLL_CALL");
    expect(s.seats.us.attendance).toBe("not_recorded");
  });

  it("scheduler factory refuses local timers in production", () => {
    const h = async () => {};
    expect(() => createScheduler({ SCHEDULER_DRIVER: "local", VERCEL: "1" }, h)).toThrow(/not allowed in production/);
    expect(() => createScheduler({ SCHEDULER_DRIVER: "qstash" }, h)).toThrow(/QSTASH_TOKEN/);
    expect(() => createScheduler({}, h)).toThrow(/SCHEDULER_DRIVER/);
  });
});
