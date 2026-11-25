import { describe, expect, it } from "vitest";
import { availableActions, normaliseDivision } from "@/engine/machine";
import type { DocumentState, Phase } from "@/engine/types";
import { ai, expectPhase, human, makeState, seats, Sim, system } from "./helpers";

// us/gb human, fr/de/jp AI — all present
const actorOf = (id: string) => (id === "us" ? human("owner") : id === "gb" ? human("u2") : ai(id));
const ALL = ["us", "gb", "fr", "de", "jp"];

function started() {
  const sim = new Sim(
    makeState(
      seats([
        ["us", "human", "owner"],
        ["gb", "human", "u2"],
        ["fr", "ai"],
        ["de", "ai"],
        ["jp", "ai"],
      ]),
    ),
  );
  sim.do(human("owner"), { type: "start" });
  for (const id of ALL) sim.do(actorOf(id), { type: "declare_attendance", seat: id, value: "present" });
  return sim;
}

function doc(id: string, title: string, operative: string[]): DocumentState {
  return { id, kind: "draft_resolution", title, sponsors: ["fr", "de"], signatories: ["gb"], preambular: ["Recalling ..."], operative, version: 1, textHash: `h-${id}`, status: "introduced", submittedBy: "fr", submittedAtMs: 0 };
}

/** Two introduced resolutions, then enter voting procedure through the real motion path. */
function inVoting(docs: DocumentState[]) {
  const sim = started();
  for (const d of docs) {
    sim.s.documents[d.id] = d;
    sim.s.introducedResolutionIds.push(d.id);
  }
  sim.do(ai("fr"), { type: "submit_motion", seat: "fr", params: { type: "enter_voting" } });
  pass(sim);
  vote(sim, () => "yes");
  return sim;
}

function pass(sim: Sim) {
  for (const id of ALL) sim.try(actorOf(id), { type: "floor_pass", seat: id });
}

function vote(sim: Sim, choice: (seat: string) => "yes" | "no" | "abstain" | null) {
  const p = sim.phase as { stage?: string; ballotId?: string };
  if (p.stage === "reading") sim.expire();
  const ballotId = (sim.phase as { ballotId: string }).ballotId;
  for (const id of ALL) {
    const c = choice(id);
    if (c && (sim.phase as { ballotId?: string }).ballotId === ballotId) sim.do(actorOf(id), { type: "cast_vote", seat: id, ballotId, choice: c });
  }
  return sim.s.ballots[ballotId];
}

describe("rule 34 — reordering resolutions", () => {
  it("default order is introduction order; proposals voted in order received; first passing wins, others discarded", () => {
    const sim = inVoting([doc("d1", "A", ["a1", "a2"]), doc("d2", "B", ["b1", "b2"]), doc("d3", "C", ["c1", "c2"])]);
    expectPhase(sim, "VP_FLOOR");
    expect((sim.phase as Extract<Phase, { type: "VP_FLOOR" }>).target).toEqual({ kind: "order" });
    expect(sim.s.votingOrder).toEqual(["d1", "d2", "d3"]);
    expect(availableActions(sim.s, "us")).toContain("submit_motion");
    // invalid orders are rejected with the rule cited
    expect(sim.try(human("owner"), { type: "submit_motion", seat: "us", params: { type: "reorder_resolutions", order: ["d1", "d2"] } })).toMatchObject({ ok: false, code: "invalid_order" });
    expect(sim.try(human("owner"), { type: "submit_motion", seat: "us", params: { type: "reorder_resolutions", order: ["d1", "d2", "d3"] } })).toMatchObject({ ok: false, code: "no_change" });
    // division is not in order in the ordering window
    expect(sim.try(human("owner"), { type: "submit_motion", seat: "us", params: { type: "divide_question", docId: "d1" } })).toMatchObject({ ok: false, code: "not_in_order" });
    sim.do(human("owner"), { type: "submit_motion", seat: "us", params: { type: "reorder_resolutions", order: ["d3", "d1", "d2"] } });
    sim.now += 10;
    sim.do(human("u2"), { type: "submit_motion", seat: "gb", params: { type: "reorder_resolutions", order: ["d2", "d3", "d1"] } });
    pass(sim);
    expectPhase(sim, "VOTING_PROCEDURE");
    // first proposal (received first) fails, second passes
    let b = vote(sim, () => "no");
    expect(b.kind).toBe("procedural");
    expect(b.result!.passed).toBe(false);
    b = vote(sim, () => "yes");
    expect(b.result!.passed).toBe(true);
    expect(sim.s.votingOrder).toEqual(["d2", "d3", "d1"]);
    expect(sim.s.reorderAdopted).toBe(true);
    // the next item is the division window of the FIRST resolution in the new order
    expectPhase(sim, "VP_FLOOR");
    expect((sim.phase as Extract<Phase, { type: "VP_FLOOR" }>).target).toEqual({ kind: "division", docId: "d2" });
  });

  it("an adopted proposal discards the remaining ones", () => {
    const sim = inVoting([doc("d1", "A", ["a1", "a2"]), doc("d2", "B", ["b1", "b2"])]);
    sim.do(human("owner"), { type: "submit_motion", seat: "us", params: { type: "reorder_resolutions", order: ["d2", "d1"] } });
    sim.now += 10;
    sim.do(ai("jp"), { type: "submit_motion", seat: "jp", params: { type: "reorder_resolutions", order: ["d2", "d1"] } });
    pass(sim);
    vote(sim, () => "yes");
    const ms = Object.values(sim.s.motions).filter((m) => m.params.type === "reorder_resolutions");
    expect(ms.map((m) => m.status).sort()).toEqual(["adopted", "obsolete"]);
  });
});

describe("rule 33 — division of the question", () => {
  function toDivision(operative: string[]) {
    const sim = inVoting([doc("d1", "A", operative)]);
    // single resolution: no ordering window; division window first
    expectPhase(sim, "VP_FLOOR");
    expect((sim.phase as Extract<Phase, { type: "VP_FLOOR" }>).target).toEqual({ kind: "division", docId: "d1" });
    sim.do(human("u2"), { type: "submit_motion", seat: "gb", params: { type: "divide_question", docId: "d1" } });
    expect(sim.try(human("owner"), { type: "submit_motion", seat: "us", params: { type: "divide_question", docId: "d1" } })).toMatchObject({ ok: false, code: "already_on_floor" });
    pass(sim);
    const b = vote(sim, () => "yes"); // procedural motion to divide
    expect(b.kind).toBe("procedural");
    expectPhase(sim, "DIVISION_PROPOSALS");
    return sim;
  }

  it("normalises proposals: listed groups + remaining clauses; validates indices", () => {
    expect(normaliseDivision(4, [[2]])).toEqual({ ok: true, parts: [[0, 1, 3], [2]] });
    expect(normaliseDivision(4, [[0], [1]])).toEqual({ ok: true, parts: [[0], [1], [2, 3]] });
    expect(normaliseDivision(3, [[0, 1, 2]])).toMatchObject({ ok: false });
    expect(normaliseDivision(3, [[5]])).toMatchObject({ ok: false });
    expect(normaliseDivision(3, [[0], [0]])).toMatchObject({ ok: false });
  });

  it("proposals voted most→least disruptive; parts voted for inclusion; recombined text gets a new version that the final vote locks", () => {
    const sim = toDivision(["c1", "c2", "c3", "c4"]);
    sim.do(human("owner"), { type: "submit_division_proposal", seat: "us", docId: "d1", parts: [[3]] }); // 2 parts
    sim.now += 10;
    sim.do(ai("fr"), { type: "submit_division_proposal", seat: "fr", docId: "d1", parts: [[0], [1]] }); // 3 parts → more disruptive
    expect(sim.try(human("owner"), { type: "submit_division_proposal", seat: "us", docId: "d1", parts: [[0, 1, 2, 3]] })).toMatchObject({ ok: false, code: "bad_division" });
    pass(sim);
    expectPhase(sim, "VOTING_PROCEDURE");
    let b = vote(sim, () => "no");
    expect(b.subject).toMatchObject({ type: "division_proposal", proposalId: Object.values(sim.s.divisionProposals!).find((x) => x.proposer === "fr")!.id });
    expect(b.kind).toBe("substantive");
    b = vote(sim, () => "yes"); // us proposal: parts [0,1,2] | [3]
    expect(sim.s.divisions!.d1.adoptedProposalId).toBe(Object.values(sim.s.divisionProposals!).find((x) => x.proposer === "us")!.id);
    // part 1 (clauses 1–3) included, part 2 (clause 4) excluded
    b = vote(sim, () => "yes");
    expect(b.subject).toMatchObject({ type: "division_part", part: 0 });
    b = vote(sim, () => "no");
    expect(b.subject).toMatchObject({ type: "division_part", part: 1 });
    const d = sim.s.documents.d1;
    expect(d.operative).toEqual(["c1", "c2", "c3"]);
    expect(d.version).toBe(2);
    expect(sim.s.divisions!.d1.outcome).toBe("recombined");
    // final vote on the recombined text, version-locked
    b = vote(sim, () => "yes");
    expect(b.subject).toMatchObject({ type: "resolution", docId: "d1", version: 2, textHash: d.textHash });
    expect(sim.s.documents.d1.status).toBe("adopted");
    expect(sim.phase).toMatchObject({ type: "CLOSED", reason: "voting_completed" });
  });

  it("no proposal passes → resolution intact; no proposals → intact", () => {
    const sim = toDivision(["c1", "c2"]);
    sim.do(human("owner"), { type: "submit_division_proposal", seat: "us", docId: "d1", parts: [[1]] });
    pass(sim);
    vote(sim, () => "no");
    expect(sim.s.divisions!.d1.outcome).toBe("intact");
    const b = vote(sim, () => "yes");
    expect(b.subject).toMatchObject({ type: "resolution", version: 1 });

    const sim2 = toDivision(["c1", "c2"]);
    pass(sim2);
    expect(sim2.s.divisions!.d1.outcome).toBe("intact");
  });

  it("all parts rejected → the resolution is rejected as a whole (no final vote)", () => {
    const sim = toDivision(["c1", "c2"]);
    sim.do(human("owner"), { type: "submit_division_proposal", seat: "us", docId: "d1", parts: [[1]] });
    pass(sim);
    vote(sim, () => "yes");
    vote(sim, () => "no");
    vote(sim, () => "no");
    expect(sim.s.documents.d1.status).toBe("failed");
    expect(sim.s.divisions!.d1.outcome).toBe("rejected_as_whole");
    expect(sim.phase).toMatchObject({ type: "CLOSED", reason: "voting_completed" });
  });

  it("a resolution with one operative clause gets no division window", () => {
    const sim = inVoting([doc("d1", "A", ["only"])]);
    expectPhase(sim, "VOTING_PROCEDURE");
    expect(sim.s.ballots[(sim.phase as { ballotId: string }).ballotId].subject).toMatchObject({ type: "resolution" });
  });
});

describe("rule 18 — yields", () => {
  function speaking() {
    const sim = started();
    sim.do(human("owner"), { type: "add_to_speakers_list", seat: "us" });
    pass(sim); // no motions → next speaker
    expectPhase(sim, "SPEECH_PREP");
    sim.expire();
    expectPhase(sim, "SPEECH");
    return sim;
  }
  it("yield to another delegate gives the remaining time; the receiver cannot yield again", () => {
    const sim = speaking();
    sim.advance(20_000);
    sim.do(human("owner"), { type: "end_speech", seat: "us", yieldTo: "gb" });
    expect(sim.phase).toMatchObject({ type: "SPEECH_CONFIRM", yieldTo: { seat: "gb", sec: 40 } });
    sim.do(human("owner"), { type: "confirm_transcript", seat: "us", text: "We support verification." });
    expect(sim.phase).toMatchObject({ type: "SPEECH_PREP", seat: "gb", context: { kind: "yield", from: "us", sec: 40 } });
    sim.expire();
    const p = sim.phase as Extract<Phase, { type: "SPEECH" }>;
    expect(p.deadlineMs - p.startedMs).toBe(40_000);
    expect(sim.try(human("u2"), { type: "end_speech", seat: "gb", yieldTo: "us" })).toMatchObject({ ok: false, code: "yield_not_in_order" });
    sim.do(human("u2"), { type: "end_speech", seat: "gb" });
    sim.do(human("u2"), { type: "skip_transcript", seat: "gb" });
    expectPhase(sim, "FLOOR_OPEN");
  });
  it("yield to an AI delegate asks for a speech sized to the remaining time", () => {
    const sim = speaking();
    sim.advance(30_000);
    sim.do(human("owner"), { type: "end_speech", seat: "us", yieldTo: "fr" });
    sim.effects = [];
    sim.do(human("owner"), { type: "skip_transcript", seat: "us" });
    expect(sim.phase).toMatchObject({ type: "AI_SPEECH_PENDING", seat: "fr" });
    expect(sim.effects.find((e) => e.type === "ai_speech_needed")).toMatchObject({ seat: "fr", maxWords: Math.floor(30 * 2.3) });
  });
  it("no yield with almost no time left, none to self", () => {
    const sim = speaking();
    expect(sim.try(human("owner"), { type: "end_speech", seat: "us", yieldTo: "us" })).toMatchObject({ ok: false, code: "yield_self" });
    sim.advance(57_000);
    expect(sim.try(human("owner"), { type: "end_speech", seat: "us", yieldTo: "gb" })).toMatchObject({ ok: false, code: "no_time" });
  });
});

describe("rule 20 — point of personal privilege", () => {
  it("is recorded (non-substantive) and available to every seat once started", () => {
    const sim = started();
    sim.effects = [];
    expect(availableActions(sim.s, "gb")).toContain("raise_point");
    const before = sim.s.contextSeq;
    sim.do(human("u2"), { type: "raise_point", seat: "gb", kind: "personal_privilege", text: "I cannot hear France" });
    expect(sim.effects.find((e) => e.type === "record")).toMatchObject({ entry: { substantive: false } });
    expect(sim.s.contextSeq).toBe(before);
    expect(sim.try(human("u2"), { type: "raise_point", seat: "us", kind: "personal_privilege", text: "x" })).toMatchObject({ ok: false, code: "forbidden_seat" });
  });
});

describe("app policy H1 — idle hold when no human is online", () => {
  it("a deadline with nobody online holds instead of advancing; reconnect resumes; long absence closes", () => {
    const sim = started();
    const phaseId = sim.s.phaseId;
    sim.do(system, { type: "connection", seat: "us", online: false });
    sim.do(system, { type: "connection", seat: "gb", online: false });
    sim.effects = [];
    sim.expire();
    expect(sim.s.phaseId).toBe(phaseId); // did not advance
    expect(sim.s.paused).toMatchObject({ reason: "no_humans" });
    expect(sim.effects.some((e) => e.type.startsWith("ai_"))).toBe(false); // no AI work while held
    // duplicate / early ticks are no-ops
    expect(sim.try(system, { type: "tick" })).toMatchObject({ ok: true, duplicate: true });
    sim.do(system, { type: "connection", seat: "gb", online: true });
    expect(sim.s.paused).toBeNull();
    expect(sim.s.usage.pauseUsedSec).toBe(0); // not charged to the owner's pause allowance
    sim.expire(); // continues with the 5s grace
    expect(sim.s.phaseId).not.toBe(phaseId);

    const sim2 = started();
    sim2.do(system, { type: "connection", seat: "us", online: false });
    sim2.do(system, { type: "connection", seat: "gb", online: false });
    sim2.expire();
    sim2.effects = [];
    sim2.expire(); // idleHoldMaxSec later
    expect(sim2.phase).toMatchObject({ type: "CLOSED", reason: "all_humans_left" });
    expect(sim2.effects.find((e) => e.type === "forum_closed")).toBeTruthy();
    expect(sim2.try(system, { type: "tick" })).toMatchObject({ ok: false, code: "closed" }); // later ticks change nothing
  });
});

describe("stale scheduler deliveries", () => {
  it("ticks for an old phase, before a deadline, during an owner pause, or after close are no-ops", () => {
    const sim = started();
    const old = sim.s.phaseId;
    sim.do(human("owner"), { type: "app_pause" });
    expect(sim.try(system, { type: "tick" })).toMatchObject({ ok: true, duplicate: true });
    sim.do(human("owner"), { type: "app_resume" });
    expect(sim.try(system, { type: "tick" })).toMatchObject({ ok: true, duplicate: true }); // deadline moved by the pause
    sim.expire();
    expect(sim.s.phaseId).not.toBe(old);
    // a delayed retry of the earlier tick carries the old phaseId → stale, never a second transition
    expect(sim.try(system, { type: "tick" }, { phaseId: old })).toMatchObject({ ok: false, stale: true });
    sim.s.phase = { type: "CLOSED", reason: "test" };
    expect(sim.try(system, { type: "tick" })).toMatchObject({ ok: false, code: "closed" });
  });
});
