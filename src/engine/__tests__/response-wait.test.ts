/**
 * App policy W1 — wait for required human responses (BridgeMUN operating policy, not an HMUN rule).
 * Controlled clock: every deadline is reached by moving the Sim clock, never by real time.
 */
import { describe, expect, it } from "vitest";
import { availableActions, effectiveSessionEndMs } from "@/engine/machine";
import { responseView } from "@/engine/responses";
import type { ForumEngineState, Phase, ResponseWait } from "@/engine/types";
import { ai, human, makeState, seats, Sim, system, T0 } from "./helpers";

const WAIT_MS = 300_000;
const H = ["h1", "h2", "h3"];
const UID: Record<string, string> = { h1: "owner", h2: "u2", h3: "u3" };
const actorOf = (id: string) => (UID[id] ? human(UID[id]) : ai(id));
const view = (s: ForumEngineState) => responseView(s, (id) => Object.keys(s.ballots[id]?.votes ?? {}));
const wait = (sim: Sim) => (sim.phase as { wait?: ResponseWait }).wait!;
const deadline = (sim: Sim) => (sim.phase as { deadlineMs: number }).deadlineMs;

/** humans h1..hN (h1 = room owner) + `aiCount` AI seats a0.., W1 on (300 s), briefing 12 s. */
function forum(humanCount: number, aiCount: number, sessionMin = 120) {
  const spec: Array<[string, "human" | "ai", string?]> = [
    ...H.slice(0, humanCount).map((h) => [h, "human", UID[h]] as [string, "human", string]),
    ...Array.from({ length: aiCount }, (_, i) => [`a${i}`, "ai"] as [string, "ai"]),
  ];
  const s = makeState(seats(spec), {}, sessionMin);
  s.settings.timers.responseWaitSec = 300;
  s.settings.timers.briefingSec = 12;
  return new Sim(s);
}
const aiIds = (sim: Sim) => Object.values(sim.s.seats).filter((x) => x.kind === "ai").map((x) => x.id);
const humanIds = (sim: Sim) => Object.values(sim.s.seats).filter((x) => x.kind === "human").map((x) => x.id);

/** start → briefing → roll call with everyone present → first floor window. */
function started(humanCount: number, aiCount: number, sessionMin = 120) {
  const sim = forum(humanCount, aiCount, sessionMin);
  sim.do(human("owner"), { type: "start" });
  sim.expire(); // briefing over
  for (const id of [...aiIds(sim), ...humanIds(sim)]) sim.do(actorOf(id), { type: "declare_attendance", seat: id, value: "present" });
  return sim;
}
function aiPass(sim: Sim) {
  for (const id of aiIds(sim)) sim.do(ai(id), { type: "floor_pass", seat: id });
}
/** Floor window with one AI motion (unmoderated caucus), everybody done → motion vote in reading stage. */
function toMotionVote(sim: Sim) {
  expect(sim.phase.type).toBe("FLOOR_OPEN");
  sim.do(ai("a0"), { type: "submit_motion", seat: "a0", params: { type: "unmod_caucus", totalSec: 300 } });
  aiPass(sim);
  for (const h of humanIds(sim)) sim.do(actorOf(h), { type: "floor_pass", seat: h });
  expect(sim.phase.type).toBe("MOTION_VOTE");
  sim.expire(); // reading time
  expect((sim.phase as { stage: string }).stage).toBe("voting");
  return (sim.phase as { ballotId: string }).ballotId;
}

describe("W1 start briefing", () => {
  it("start shows a shared briefing; roll call (and the session clock) start when it ends", () => {
    const sim = forum(2, 3);
    sim.do(human("owner"), { type: "start" });
    expect(sim.phase.type).toBe("BRIEFING");
    expect((sim.phase as Extract<Phase, { type: "BRIEFING" }>).startedMs).toBe(T0);
    expect(sim.s.settings.sessionStartMs).toBe(T0 + 12_000);
    expect(sim.try(human("owner"), { type: "declare_attendance", seat: "h1", value: "present" }).ok).toBe(false);
    expect(sim.effects.some((e) => e.type === "ai_attendance_needed")).toBe(false);
    sim.expire();
    expect(sim.phase.type).toBe("ROLL_CALL");
    expect(sim.effects.some((e) => e.type === "ai_attendance_needed")).toBe(true);
    expect(wait(sim).responseDeadlineMs).toBe(sim.now + WAIT_MS);
  });
});

describe("W1 votes: 10 AI + 3 humans", () => {
  it("all AI and 2 of 3 humans voted → the vote waits for the third human; their vote closes it at once", () => {
    const sim = started(3, 10);
    const b = toMotionVote(sim);
    for (const id of aiIds(sim)) sim.do(ai(id), { type: "cast_vote", seat: id, ballotId: b, choice: "yes" });
    sim.do(human("owner"), { type: "cast_vote", seat: "h1", ballotId: b, choice: "no" });
    sim.do(human("u2"), { type: "cast_vote", seat: "h2", ballotId: b, choice: "yes" });
    expect(sim.phase.type).toBe("MOTION_VOTE");
    expect(view(sim.s)!.pending).toEqual(["h3"]);
    // normal voting timer (45 s) runs out → held, not closed
    const w = wait(sim);
    sim.expire();
    expect(sim.phase.type).toBe("MOTION_VOTE");
    expect(w.responseDeadlineMs - w.requestedAtMs).toBe(WAIT_MS);
    expect(deadline(sim)).toBe(w.responseDeadlineMs);
    expect(wait(sim).holding).toBe(true);
    sim.advance(120_000);
    sim.do(human("u3"), { type: "cast_vote", seat: "h3", ballotId: b, choice: "yes" });
    expect(sim.s.ballots[b].status).toBe("closed");
    expect(sim.s.ballots[b].result!.notVoted).toEqual([]);
    expect(sim.phase.type).toBe("UNMOD_CAUCUS");
  });

  it("nobody waits for the timer when every human and AI has voted", () => {
    const sim = started(3, 10);
    const b = toMotionVote(sim);
    const t = sim.now;
    for (const id of [...aiIds(sim), ...H]) sim.do(actorOf(id), { type: "cast_vote", seat: id, ballotId: b, choice: "yes" });
    expect(sim.s.ballots[b].status).toBe("closed");
    expect(sim.now).toBe(t);
  });

  it("expiry: the silent human is recorded as NOT VOTING (never abstain/yes/no); record explains it", () => {
    const sim = started(3, 10);
    const b = toMotionVote(sim);
    for (const id of [...aiIds(sim), "h1", "h2"]) sim.do(actorOf(id), { type: "cast_vote", seat: id, ballotId: b, choice: "yes" });
    sim.expire(); // base → held
    sim.expire(); // response deadline
    const r = sim.s.ballots[b].result!;
    expect(sim.s.ballots[b].votes.h3).toBeUndefined();
    expect(r.notVoted).toEqual(["h3"]);
    expect(r.abstain).toBe(0);
    expect(r.yes).toBe(12);
    const rec = sim.records().find((x) => x.kind === "response_timeout")!;
    expect(rec.text).toMatch(/H3 did not vote within 5 min; recorded as not voting \(not as abstaining\)/);
  });

  it("AI that never vote do not hold the meeting past the normal timer once humans are done", () => {
    const sim = started(2, 3);
    const b = toMotionVote(sim);
    sim.do(human("owner"), { type: "cast_vote", seat: "h1", ballotId: b, choice: "yes" });
    sim.do(human("u2"), { type: "cast_vote", seat: "h2", ballotId: b, choice: "yes" });
    expect(sim.phase.type).toBe("MOTION_VOTE"); // AI still deciding, normal timer still running
    sim.expire();
    expect(sim.s.ballots[b].status).toBe("closed");
    expect(sim.s.ballots[b].result!.notVoted.sort()).toEqual(["a0", "a1", "a2"]);
  });

  it("duplicate / early ticks and a vote racing the deadline are consistent", () => {
    const sim = started(3, 2);
    const b = toMotionVote(sim);
    for (const id of [...aiIds(sim), "h1", "h2"]) sim.do(actorOf(id), { type: "cast_vote", seat: id, ballotId: b, choice: "yes" });
    sim.expire(); // held
    const phaseId = sim.s.phaseId;
    // early and duplicate deliveries are no-ops
    sim.advance(1000);
    expect(sim.do(system, { type: "tick" }, { phaseId }).duplicate).toBe(true);
    // the last vote arrives at the exact deadline instant, before the tick → counted
    sim.now = wait(sim).responseDeadlineMs;
    sim.do(human("u3"), { type: "cast_vote", seat: "h3", ballotId: b, choice: "no" });
    expect(sim.s.ballots[b].result!.no).toBe(1);
    // the scheduler tick for that deadline arrives afterwards: stale phase → rejected, no second transition
    const late = sim.try(system, { type: "tick" }, { phaseId });
    expect(late.ok).toBe(false);
    // a second vote after close is refused
    expect(sim.try(human("u3"), { type: "cast_vote", seat: "h3", ballotId: b, choice: "yes" }, { ballotId: b }).ok).toBe(false);
  });
});

describe("W1 floor windows", () => {
  it("a delegate with no motion completes the window with “no motion”; moving a motion also counts", () => {
    const sim = started(2, 3);
    expect(sim.phase.type).toBe("FLOOR_OPEN");
    aiPass(sim);
    sim.do(human("owner"), { type: "submit_motion", seat: "h1", params: { type: "unmod_caucus", totalSec: 300 } });
    expect(view(sim.s)!.pending).toEqual(["h2"]);
    expect(sim.phase.type).toBe("FLOOR_OPEN");
    sim.do(human("u2"), { type: "floor_pass", seat: "h2" });
    expect(sim.phase.type).toBe("MOTION_VOTE");
  });

  it("speaking, voting or signing up elsewhere never completes the floor response", () => {
    const sim = started(2, 3);
    sim.do(human("u2"), { type: "add_to_speakers_list", seat: "h2" });
    sim.do(human("u2"), { type: "raise_point", seat: "h2", kind: "personal_privilege", text: "audio" });
    expect(view(sim.s)!.pending).toContain("h2");
  });

  it("held window: expiry treats the silent human as having no motion and the meeting continues", () => {
    const sim = started(2, 3);
    aiPass(sim);
    sim.do(human("owner"), { type: "floor_pass", seat: "h1" });
    sim.expire();
    const w0 = (sim.phase as { windowId: string }).windowId;
    expect(sim.phase.type).toBe("FLOOR_OPEN");
    sim.expire();
    expect((sim.phase as { windowId?: string }).windowId).not.toBe(w0); // next window (empty speakers' list)
    expect(sim.records().some((r) => r.kind === "response_timeout" && /H2 did not respond within 5 min; treated as having no motion/.test(r.text))).toBe(true);
  });

  it("+30 s extensions are not offered (the response window replaces them)", () => {
    const sim = started(2, 3);
    expect(availableActions(sim.s, "h1")).not.toContain("request_extension");
    expect(sim.try(human("owner"), { type: "request_extension", seat: "h1" }).ok).toBe(false);
  });
});

describe("W1 reconnects and leaving (connection never shortens a response window)", () => {
  /** 3 humans: h1 and h3 answer, h2 is awaited on the floor (held past the normal timer). */
  function heldForH2() {
    const sim = started(3, 3);
    aiPass(sim);
    sim.do(human("owner"), { type: "floor_pass", seat: "h1" });
    sim.do(human("u3"), { type: "floor_pass", seat: "h3" });
    sim.expire(); // normal timer → held for h2
    expect(view(sim.s)!.pending).toEqual(["h2"]);
    return sim;
  }

  it("1 of 3 humans disconnects while awaited → the ORIGINAL deadline is kept (no early skip)", () => {
    const sim = heldForH2();
    const due = wait(sim).responseDeadlineMs;
    const w0 = (sim.phase as { windowId: string }).windowId;
    sim.advance(30_000);
    sim.do(system, { type: "connection", seat: "h2", online: false });
    expect(deadline(sim)).toBe(due);
    sim.advance(60_000); // well past any old grace period
    expect(sim.do(system, { type: "tick" }, { phaseId: sim.s.phaseId }).duplicate).toBe(true);
    expect((sim.phase as { windowId: string }).windowId).toBe(w0);
    expect(view(sim.s)!.pending).toEqual(["h2"]);
    expect(sim.records().some((r) => r.kind === "not_awaited")).toBe(false);
  });

  it("reconnecting before the deadline: same remaining time, and the delegate can still respond", () => {
    const sim = heldForH2();
    const due = wait(sim).responseDeadlineMs;
    sim.do(system, { type: "connection", seat: "h2", online: false });
    sim.advance(90_000);
    sim.do(system, { type: "connection", seat: "h2", online: true });
    expect(wait(sim).responseDeadlineMs).toBe(due); // remaining = due - now, not reset to 5 min
    sim.do(human("u2"), { type: "submit_motion", seat: "h2", params: { type: "unmod_caucus", totalSec: 300 } });
    expect(sim.phase.type).toBe("MOTION_VOTE");
  });

  it("still offline at the deadline → the step's normal automatic handling (no motion)", () => {
    const sim = heldForH2();
    sim.do(system, { type: "connection", seat: "h2", online: false });
    sim.expire();
    expect(sim.records().some((r) => r.kind === "response_timeout" && /H2 did not respond within 5 min; treated as having no motion/.test(r.text))).toBe(true);
  });

  it("an offline voter keeps the vote window too; at expiry they are recorded as not voting", () => {
    const sim = started(3, 2);
    const b = toMotionVote(sim);
    for (const id of [...aiIds(sim), "h1", "h3"]) sim.do(actorOf(id), { type: "cast_vote", seat: id, ballotId: b, choice: "yes" });
    sim.do(system, { type: "connection", seat: "h2", online: false });
    sim.expire(); // normal 45 s → held although h2 is offline
    expect(sim.s.ballots[b].status).toBe("open");
    sim.expire();
    expect(sim.s.ballots[b].result!.notVoted).toEqual(["h2"]);
    expect(sim.s.ballots[b].result!.notVotedOffline).toEqual(["h2"]);
  });

  it("H1 is separate: nobody online → idle hold at the deadline; the window is shifted on return, not reset", () => {
    const sim = started(2, 3);
    aiPass(sim);
    const due = wait(sim).responseDeadlineMs;
    sim.do(system, { type: "connection", seat: "h1", online: false });
    sim.do(system, { type: "connection", seat: "h2", online: false });
    sim.expire();
    expect(sim.s.paused?.reason).toBe("no_humans");
    sim.advance(100_000);
    sim.do(system, { type: "connection", seat: "h2", online: true });
    expect(sim.s.paused).toBeNull();
    expect(wait(sim).responseDeadlineMs).toBe(due + 100_000);
  });

  it("H1 close still applies after 10 min with nobody back", () => {
    const sim = started(2, 3);
    aiPass(sim);
    sim.do(system, { type: "connection", seat: "h1", online: false });
    sim.do(system, { type: "connection", seat: "h2", online: false });
    sim.expire();
    sim.expire();
    expect(sim.phase.type).toBe("CLOSED");
    expect((sim.phase as { reason: string }).reason).toBe("all_humans_left");
  });
});

describe("W1 standing “no motion” (no repeated confirmations)", () => {
  /** Empty speakers' list, no motions: the floor reopens with nothing changed. */
  function emptyLoop() {
    const sim = started(2, 3);
    aiPass(sim);
    sim.do(human("owner"), { type: "floor_pass", seat: "h1" });
    sim.do(human("u2"), { type: "floor_pass", seat: "h2" });
    expect(sim.phase.type).toBe("FLOOR_OPEN"); // next window, same situation
    return sim;
  }

  it("unchanged situation → earlier “no motion” stands: nobody is asked again, the window keeps its normal time", () => {
    const sim = emptyLoop();
    const v = view(sim.s)!;
    expect(v.pending).toEqual([]);
    expect(v.standing.sort()).toEqual(["h1", "h2"]);
    aiPass(sim);
    expect(sim.phase.type).toBe("FLOOR_OPEN"); // not closed early: humans may still move a motion
    const w0 = (sim.phase as { windowId: string }).windowId;
    sim.expire(); // normal 45 s
    expect((sim.phase as { windowId: string }).windowId).not.toBe(w0);
    expect(sim.records().some((r) => r.kind === "response_timeout")).toBe(false);
  });

  it("a standing delegate can still move a motion whenever they want", () => {
    const sim = emptyLoop();
    sim.do(human("u2"), { type: "submit_motion", seat: "h2", params: { type: "unmod_caucus", totalSec: 300 } });
    aiPass(sim);
    sim.expire();
    expect(sim.phase.type).toBe("MOTION_VOTE");
    expect(sim.s.standingNoMotion?.h2).toBeUndefined(); // active again → asked normally next time
  });

  it("a meaningful change (new speaker on the list) asks everyone again", () => {
    const sim = started(2, 3);
    aiPass(sim);
    sim.do(human("owner"), { type: "floor_pass", seat: "h1" });
    sim.do(ai("a1"), { type: "add_to_speakers_list", seat: "a1" });
    sim.do(human("u2"), { type: "floor_pass", seat: "h2" });
    // a1 speaks, then the floor reopens after a new statement
    expect(sim.phase.type).toBe("AI_SPEECH_PENDING");
    sim.do(ai("a1"), { type: "ai_speech_ready", seat: "a1", text: "Statement", contextSeq: sim.s.contextSeq });
    sim.expire();
    expect(sim.phase.type).toBe("FLOOR_OPEN");
    expect(view(sim.s)!.pending.sort()).toEqual(["h1", "h2"]);
  });

  it("a new motion in the next window: the motion is voted (everyone takes part) and the window after it asks again", () => {
    const sim = emptyLoop();
    sim.do(ai("a0"), { type: "submit_motion", seat: "a0", params: { type: "unmod_caucus", totalSec: 120 } });
    aiPass(sim);
    sim.expire();
    expect(sim.phase.type).toBe("MOTION_VOTE");
    sim.expire();
    expect(view(sim.s)!.pending.sort()).toEqual(["h1", "h2"]); // the vote needs both humans
  });
});

describe("W1 speeches", () => {
  function recognise() {
    const sim = started(2, 3);
    sim.do(human("u2"), { type: "add_to_speakers_list", seat: "h2" });
    aiPass(sim);
    sim.do(human("owner"), { type: "floor_pass", seat: "h1" });
    sim.do(human("u2"), { type: "floor_pass", seat: "h2" });
    expect(sim.phase.type).toBe("SPEECH_PREP");
    return sim;
  }

  it("only the recognised speaker is awaited; h1 (not on the list) is never asked to speak", () => {
    const sim = recognise();
    expect(view(sim.s)!.required).toEqual(["h2"]);
    expect(availableActions(sim.s, "h1")).not.toContain("start_speech");
  });

  it("the speaker starts the speech; speaking time is the normal speaking time, not the 5-minute window", () => {
    const sim = recognise();
    sim.expire(); // 10 s prep passed → held
    expect(sim.phase.type).toBe("SPEECH_PREP");
    sim.advance(60_000);
    sim.do(human("u2"), { type: "start_speech", seat: "h2" });
    expect(sim.phase.type).toBe("SPEECH");
    expect(deadline(sim) - sim.now).toBe(sim.s.speakingTimeSec * 1000);
  });

  it("speech never started → turn ends with no speech after the window (recorded)", () => {
    const sim = recognise();
    sim.expire();
    sim.expire();
    expect(sim.phase.type).toBe("FLOOR_OPEN");
    expect(sim.records().some((r) => r.source === "human_forfeit" && /did not start the speech/.test(r.text))).toBe(true);
  });

  it("the general speakers' list is kept through a caucus and resumes afterwards", () => {
    const sim = started(2, 3);
    sim.do(human("u2"), { type: "add_to_speakers_list", seat: "h2" });
    sim.do(ai("a1"), { type: "add_to_speakers_list", seat: "a1" });
    const b = toMotionVote(sim);
    for (const id of [...aiIds(sim), "h1", "h2"]) sim.do(actorOf(id), { type: "cast_vote", seat: id, ballotId: b, choice: "yes" });
    expect(sim.phase.type).toBe("UNMOD_CAUCUS");
    expect(sim.s.speakersList).toEqual(["h2", "a1"]);
    sim.expire(); // caucus ends at its adopted time (no 5-minute hold)
    expect(sim.phase.type).toBe("FLOOR_OPEN");
    expect(sim.s.speakersList).toEqual(["h2", "a1"]);
  });
});

describe("W1 moderated caucus volunteering", () => {
  it("humans answer Volunteer or Pass; nobody is forced to speak", () => {
    const sim = started(2, 3);
    sim.do(ai("a0"), { type: "submit_motion", seat: "a0", params: { type: "mod_caucus", topic: "T", speakingSec: 60, totalSec: 300 } });
    aiPass(sim);
    for (const h of ["h1", "h2"]) sim.do(actorOf(h), { type: "floor_pass", seat: h });
    sim.expire();
    const b = (sim.phase as { ballotId: string }).ballotId;
    for (const id of [...aiIds(sim), "h1", "h2"]) sim.do(actorOf(id), { type: "cast_vote", seat: id, ballotId: b, choice: "yes" });
    expect(sim.phase.type).toBe("MOD_CAUCUS");
    sim.do(ai("a1"), { type: "volunteer", seat: "a1" });
    sim.do(human("owner"), { type: "volunteer_pass", seat: "h1" });
    sim.expire(); // 15 s → held for h2
    expect(sim.phase.type).toBe("MOD_CAUCUS");
    sim.do(human("u2"), { type: "volunteer_pass", seat: "h2" });
    expect(sim.phase.type).toBe("AI_SPEECH_PENDING");
    expect((sim.phase as { seat: string }).seat).toBe("a1");
  });
});

describe("W1 caucus pass scopes", () => {
  function inCaucus() {
    const sim = started(2, 3);
    sim.do(ai("a0"), { type: "submit_motion", seat: "a0", params: { type: "mod_caucus", topic: "T", speakingSec: 30, totalSec: 300 } });
    aiPass(sim);
    for (const h of ["h1", "h2"]) sim.do(actorOf(h), { type: "floor_pass", seat: h });
    sim.expire();
    const b = (sim.phase as { ballotId: string }).ballotId;
    for (const id of [...aiIds(sim), "h1", "h2"]) sim.do(actorOf(id), { type: "cast_vote", seat: id, ballotId: b, choice: "yes" });
    expect(sim.phase.type).toBe("MOD_CAUCUS");
    return sim;
  }
  /** a1 volunteers each turn, its speech ends → next volunteer turn. */
  function nextTurn(sim: Sim) {
    sim.do(ai("a1"), { type: "volunteer", seat: "a1" });
    sim.expire();
    sim.do(ai("a1"), { type: "ai_speech_ready", seat: "a1", text: "x", contextSeq: sim.s.contextSeq });
    sim.expire();
    expect(sim.phase.type).toBe("MOD_CAUCUS");
  }

  it("“Pass this turn” is for this turn only: asked again next turn", () => {
    const sim = inCaucus();
    sim.do(human("owner"), { type: "volunteer_pass", seat: "h1" });
    sim.do(human("u2"), { type: "volunteer_pass", seat: "h2", scope: "turn" });
    nextTurn(sim);
    expect(view(sim.s)!.pending.sort()).toEqual(["h1", "h2"]);
  });

  it("“Pass for the rest of this caucus” is not asked again, can be undone, and never blocks volunteering", () => {
    const sim = inCaucus();
    sim.do(human("owner"), { type: "volunteer_pass", seat: "h1", scope: "caucus" });
    sim.do(human("u2"), { type: "volunteer_pass", seat: "h2" });
    nextTurn(sim);
    expect(view(sim.s)!.pending).toEqual(["h2"]);
    expect(view(sim.s)!.standing).toEqual(["h1"]);
    sim.do(human("owner"), { type: "volunteer", seat: "h1" }); // still free to speak
    expect(sim.s.activeCaucus!.passAll).toEqual([]);
    expect(sim.try(human("owner"), { type: "volunteer_pass", seat: "h1", scope: "caucus" }).ok).toBe(false); // already volunteered this turn
  });

  it("the caucus-wide pass ends with the caucus (next caucus asks again)", () => {
    const sim = inCaucus();
    sim.do(human("owner"), { type: "volunteer_pass", seat: "h1", scope: "caucus" });
    expect(sim.s.activeCaucus!.passAll).toEqual(["h1"]);
    sim.do(human("u2"), { type: "volunteer_pass", seat: "h2" });
    sim.expire(); // nobody volunteers → caucus ends
    expect(sim.s.activeCaucus).toBeNull();
  });
});

describe("W1 roll call and sponsors", () => {
  it("roll call: a silent human stays not recorded (no attendance chosen for them); quorum met → debate opens", () => {
    const sim = forum(2, 3);
    sim.do(human("owner"), { type: "start" });
    sim.expire();
    for (const id of [...aiIds(sim), "h1"]) sim.do(actorOf(id), { type: "declare_attendance", seat: id, value: "present" });
    sim.expire(); // 60 s → held for h2
    expect(sim.phase.type).toBe("ROLL_CALL");
    sim.expire();
    expect(sim.s.seats.h2.attendance).toBe("not_recorded");
    expect(sim.phase.type).toBe("FLOOR_OPEN");
    expect(sim.records().some((r) => r.kind === "response_timeout" && /no attendance was chosen/.test(r.text))).toBe(true);
  });

  it("silent human sponsor → friendly consent NOT OBTAINED (distinct from an objection)", () => {
    const sim = started(2, 3);
    sim.s.documents.d1 = { id: "d1", kind: "draft_resolution", title: "R", sponsors: ["h2", "a0"], signatories: [], preambular: ["P"], operative: ["O1", "O2"], version: 1, textHash: "x", status: "introduced", submittedBy: "h2", submittedAtMs: 0 };
    sim.s.introducedResolutionIds.push("d1");
    sim.do(ai("a1"), { type: "submit_amendment", seat: "a1", targetDocId: "d1", op: { kind: "replace", clauseIndex: 1, text: "O2b" } });
    const aid = Object.keys(sim.s.amendments)[0];
    sim.do(ai("a2"), { type: "sign_amendment", seat: "a2", amendmentId: aid });
    sim.do(ai("a0"), { type: "sign_amendment", seat: "a0", amendmentId: aid });
    sim.do(ai("a1"), { type: "submit_motion", seat: "a1", params: { type: "introduce_amendment", amendmentId: aid } });
    aiPass(sim);
    for (const h of ["h1", "h2"]) sim.do(actorOf(h), { type: "floor_pass", seat: h });
    sim.expire();
    const b = (sim.phase as { ballotId: string }).ballotId;
    for (const id of [...aiIds(sim), "h1", "h2"]) sim.do(actorOf(id), { type: "cast_vote", seat: id, ballotId: b, choice: "yes" });
    expect(sim.phase.type).toBe("AMENDMENT_SPONSOR_RESPONSE");
    sim.do(ai("a0"), { type: "sponsor_response", seat: "a0", amendmentId: aid, agree: true });
    expect(view(sim.s)!.pending).toEqual(["h2"]);
    sim.expire(); // base 30 s → held
    expect(sim.phase.type).toBe("AMENDMENT_SPONSOR_RESPONSE");
    sim.expire();
    expect(sim.s.amendments[aid].friendlyOutcome).toBe("consent_not_obtained");
    expect(sim.s.amendments[aid].status).toBe("unfriendly_pending");
  });
});

describe("W1 session time budget", () => {
  it("time held for humans is added back once (not per waiting human) and the UI end matches the engine", () => {
    const sim = started(3, 2, 30);
    const end0 = sim.s.settings.sessionEndsAtMs;
    aiPass(sim);
    sim.do(human("owner"), { type: "floor_pass", seat: "h1" });
    // h2 and h3 both silent → held; 3 min pass
    sim.expire();
    const base = wait(sim).baseDeadlineMs;
    sim.advance(180_000);
    expect(effectiveSessionEndMs(sim.s, sim.now)).toBe(end0 + (sim.now - base));
    sim.do(human("u2"), { type: "floor_pass", seat: "h2" });
    const w0 = (sim.phase as { windowId: string }).windowId;
    sim.do(human("u3"), { type: "floor_pass", seat: "h3" });
    expect((sim.phase as { windowId?: string }).windowId).not.toBe(w0);
    expect(sim.s.settings.sessionEndsAtMs).toBe(end0 + (sim.now - base));
    expect(sim.s.usage.responseWaitCreditMs).toBe(sim.now - base);
  });

  it("phases closed early by responses add nothing", () => {
    const sim = started(2, 2, 30);
    const end0 = sim.s.settings.sessionEndsAtMs;
    aiPass(sim);
    for (const h of ["h1", "h2"]) sim.do(actorOf(h), { type: "floor_pass", seat: h });
    expect(sim.s.settings.sessionEndsAtMs).toBe(end0);
  });
});
