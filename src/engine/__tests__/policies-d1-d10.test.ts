import { describe, expect, it } from "vitest";
import { effectiveDocThresholds, MIN_SEATS } from "@/engine/documents";
import { defaultSettingsBase } from "@/engine/machine";
import { APP_DEFAULT_POLICIES } from "@/engine/policies";
import { openBallot, tally } from "@/engine/voting";
import type { Phase, Seat, VoteChoice } from "@/engine/types";
import { ai, expectPhase, human, makeState, seats, Sim, system } from "./helpers";

const SEATS = () => seats([["us", "human", "owner"], ["gb", "human", "u2"], ["fr", "ai"], ["de", "ai"], ["jp", "ai"]]);
const actorOf = (id: string) => (id === "us" ? human("owner") : id === "gb" ? human("u2") : ai(id));
const ALL = ["us", "gb", "fr", "de", "jp"];

function started(sessionMin = 120) {
  const sim = new Sim(makeState(SEATS(), {}, sessionMin));
  sim.do(human("owner"), { type: "start" });
  for (const id of ALL) sim.do(actorOf(id), { type: "declare_attendance", seat: id, value: "present" });
  return sim;
}
function passFloor(sim: Sim) {
  for (const id of ALL) sim.try(actorOf(id), { type: "floor_pass", seat: id });
}
function vote(sim: Sim, choices: Record<string, VoteChoice>) {
  if ((sim.phase as { stage?: string }).stage === "reading") sim.expire();
  const ballotId = (sim.phase as { ballotId: string }).ballotId;
  for (const [id, c] of Object.entries(choices)) sim.do(actorOf(id), { type: "cast_vote", seat: id, ballotId, choice: c });
  // Not everyone voted → no early close; let the voting window (and D2 extension, if any) run out.
  while ((sim.phase as { ballotId?: string }).ballotId === ballotId) sim.expire();
  return ballotId;
}

describe("D1 procedural: majority of the electorate fixed at open (app policy)", () => {
  function mk(n: number, votes: Array<VoteChoice | null>) {
    const ss: Record<string, Seat> = {};
    for (let i = 0; i < n; i++) ss[`s${i}`] = { id: `s${i}`, countryName: "", kind: "ai", attendance: "present", connection: "online" };
    const b = openBallot({ id: "b", kind: "procedural", threshold: "simple_majority", subject: { type: "motion", motionId: "m" }, seats: ss, nowMs: 0 });
    votes.forEach((v, i) => v && (b.votes[`s${i}`] = v));
    return tally(b, APP_DEFAULT_POLICIES.proceduralNonResponse, {});
  }
  // [eligible, yes, no, expected]
  const table: Array<[number, number, number, boolean]> = [
    [5, 2, 0, false], [5, 3, 0, true], [5, 3, 2, true], [4, 2, 0, false], [4, 3, 1, true], [3, 1, 0, false], [3, 2, 1, true], [10, 5, 0, false], [10, 6, 4, true],
  ];
  it.each(table)("eligible %i: yes %i no %i → %s", (n, y, no, expected) => {
    const votes: Array<VoteChoice | null> = [];
    for (let i = 0; i < n; i++) votes.push(i < y ? "yes" : i < y + no ? "no" : null);
    const r = mk(n, votes);
    expect(r.passed).toBe(expected);
    expect(r.notVoted.length).toBe(n - y - no); // non-voters stay "not voted", never converted
  });
  it("no votes at all never passes", () => expect(mk(3, [null, null, null]).passed).toBe(false));
});

describe("D2 substantive: rule 35 with one extension; abstain vs not voted", () => {
  it("extends once, then reports abstentions and non-votes separately; zero Yes never passes", () => {
    const ss: Record<string, Seat> = {};
    for (const id of ["a", "b", "c", "d"]) ss[id] = { id, countryName: "", kind: "ai", attendance: "present", connection: "online" };
    const b = openBallot({ id: "b", kind: "substantive", threshold: "simple_majority", subject: { type: "resolution", docId: "d", version: 1, textHash: "h" }, seats: ss, nowMs: 0 });
    b.votes = { a: "abstain", b: "abstain" };
    let r = tally(b, APP_DEFAULT_POLICIES.substantiveNonResponse, {});
    expect(r).toMatchObject({ yes: 0, no: 0, abstain: 2, notVoted: ["c", "d"], passed: false });
    b.votes = { a: "yes", b: "abstain" };
    r = tally(b, APP_DEFAULT_POLICIES.substantiveNonResponse, {});
    expect(r).toMatchObject({ yes: 1, no: 0, abstain: 1, passed: true }); // rule 35: Yes > No
  });
});

describe("D3 carry-over is re-validated and marked", () => {
  it("carried motion keeps its origin window id and is voted first next window", () => {
    const sim = started();
    sim.do(human("owner"), { type: "submit_motion", seat: "us", params: { type: "set_speaking_time", speakingSec: 45 } });
    sim.do(ai("fr"), { type: "submit_motion", seat: "fr", params: { type: "unmod_caucus", totalSec: 60 } });
    const firstWindow = (sim.phase as Extract<Phase, { type: "FLOOR_OPEN" }>).windowId;
    passFloor(sim);
    vote(sim, { us: "yes", gb: "yes", fr: "yes" }); // 3 of 5 → passes under D1
    expectPhase(sim, "UNMOD_CAUCUS");
    sim.expire();
    const carried = Object.values(sim.s.motions).find((m) => m.params.type === "set_speaking_time")!;
    expect(carried.carriedFromWindowId).toBe(firstWindow);
    expect(carried.windowId).toBe(sim.s.phaseId);
  });

  it("a carried motion that lost its legality is not voted (obsolete with reason)", () => {
    const sim = started(4);
    sim.do(human("owner"), { type: "submit_motion", seat: "us", params: { type: "set_speaking_time", speakingSec: 45 } });
    sim.do(ai("fr"), { type: "submit_motion", seat: "fr", params: { type: "unmod_caucus", totalSec: 60 } });
    passFloor(sim);
    vote(sim, { us: "yes", gb: "yes", fr: "yes" });
    // speaking time changes by another route? Use session time: after the caucus the session is over.
    sim.now = sim.s.settings.sessionEndsAtMs + 1;
    sim.expire();
    expectPhase(sim, "CLOSED"); // D6: no resolution introduced → closed, carried motion obsolete
    const carried = Object.values(sim.s.motions).find((m) => m.params.type === "set_speaking_time")!;
    expect(carried.status).toBe("obsolete");
    expect(sim.records().some((r) => /No resolution was introduced/.test(r.text))).toBe(true);
  });
});

describe("D5 sponsor silence vs objection", () => {
  function toSponsorResponse() {
    const sim = started();
    sim.do(ai("fr"), { type: "submit_motion", seat: "fr", params: { type: "unmod_caucus", totalSec: 300 } });
    passFloor(sim);
    vote(sim, { us: "yes", gb: "yes", fr: "yes" });
    sim.do(ai("fr"), { type: "submit_document", seat: "fr", kind: "draft_resolution", title: "T", preambular: ["P"], operative: ["O1", "O2"] });
    const docId = Object.keys(sim.s.documents)[0];
    sim.do(ai("de"), { type: "sign_document", seat: "de", docId, role: "sponsor" });
    sim.do(ai("jp"), { type: "sign_document", seat: "jp", docId, role: "signatory" });
    sim.expire();
    sim.do(ai("de"), { type: "submit_motion", seat: "de", params: { type: "introduce_resolution" } });
    passFloor(sim);
    vote(sim, { us: "yes", gb: "yes", fr: "yes" });
    sim.expire();
    sim.expire();
    sim.do(human("owner"), { type: "submit_amendment", seat: "us", targetDocId: docId, op: { kind: "replace", clauseIndex: 0, text: "X" } });
    const amId = Object.keys(sim.s.amendments)[0];
    sim.do(human("u2"), { type: "sign_amendment", seat: "gb", amendmentId: amId });
    sim.do(ai("jp"), { type: "sign_amendment", seat: "jp", amendmentId: amId });
    sim.do(human("owner"), { type: "submit_motion", seat: "us", params: { type: "introduce_amendment", amendmentId: amId } });
    passFloor(sim);
    vote(sim, { us: "yes", gb: "yes", jp: "yes" });
    expectPhase(sim, "AMENDMENT_SPONSOR_RESPONSE");
    return { sim, amId };
  }
  it("silence → one extension → consent_not_obtained (not an objection)", () => {
    const { sim, amId } = toSponsorResponse();
    sim.do(ai("fr"), { type: "sponsor_response", seat: "fr", amendmentId: amId, agree: true });
    sim.expire();
    expectPhase(sim, "AMENDMENT_SPONSOR_RESPONSE"); // extended once
    sim.expire();
    expect(sim.s.amendments[amId]).toMatchObject({ status: "unfriendly_pending", friendlyOutcome: "consent_not_obtained" });
    expect(sim.records().at(-1)?.text).toMatch(/no objection was recorded/);
  });
  it("explicit objection → objected", () => {
    const { sim, amId } = toSponsorResponse();
    sim.do(ai("de"), { type: "sponsor_response", seat: "de", amendmentId: amId, agree: false });
    expect(sim.s.amendments[amId]).toMatchObject({ status: "unfriendly_pending", friendlyOutcome: "objected" });
  });
});

describe("D6 time-based end never cuts a running vote", () => {
  it("vote that straddles session end gets its full reading and voting time", () => {
    const sim = started(10);
    sim.now += 9 * 60_000 + 50_000; // 10s before end
    sim.do(ai("fr"), { type: "submit_motion", seat: "fr", params: { type: "set_speaking_time", speakingSec: 45 } });
    passFloor(sim);
    expectPhase(sim, "MOTION_VOTE");
    sim.expire(); // reading (after session end)
    expect((sim.phase as { stage: string }).stage).toBe("voting");
    const p = sim.phase as { deadlineMs: number };
    expect(p.deadlineMs - sim.now).toBe(45_000); // full voting time despite time being up
    sim.expire();
    expectPhase(sim, "CLOSED");
  });
});

describe("D7 not held ≠ rejected; can be moved again", () => {
  it("records NOT HELD and allows the same motion in a later window", () => {
    const sim = new Sim(makeState(SEATS()));
    sim.do(human("owner"), { type: "start" });
    sim.do(ai("fr"), { type: "declare_attendance", seat: "fr", value: "present" });
    sim.do(ai("de"), { type: "declare_attendance", seat: "de", value: "present" });
    sim.expire();
    sim.do(ai("fr"), { type: "submit_motion", seat: "fr", params: { type: "unmod_caucus", totalSec: 300 } });
    sim.expire();
    const m = Object.values(sim.s.motions)[0];
    expect(m.status).toBe("not_held");
    expect(sim.records().some((r) => /NOT HELD/.test(r.text) && /not a rejection/i.test(r.text))).toBe(true);
    expectPhase(sim, "FLOOR_OPEN");
    expect(sim.try(ai("fr"), { type: "submit_motion", seat: "fr", params: { type: "unmod_caucus", totalSec: 300 } }).ok).toBe(true);
  });
});

describe("D9 document thresholds stay satisfiable in small forums", () => {
  const docs = defaultSettingsBase().documents;
  it.each(Array.from({ length: 58 }, (_, i) => i + MIN_SEATS))("%i seats", (n) => {
    const t = effectiveDocThresholds(n, docs);
    expect(t.sponsors).toBeGreaterThanOrEqual(1);
    expect(t.sponsors + t.signatories).toBeLessThanOrEqual(n);
    expect(1 + t.amendmentSignatories).toBeLessThanOrEqual(n);
    if (n >= 5) expect(t).toMatchObject({ sponsors: 2, signatories: Math.ceil(0.2 * n), amendmentSignatories: 2 });
  });
  it("3 seats: 2 sponsors + 1 signatory; forums below 3 seats are refused", () => {
    expect(effectiveDocThresholds(3, docs)).toEqual({ sponsors: 2, signatories: 1, amendmentSignatories: 2 });
    expect(() => makeState(seats([["us", "human", "owner"], ["fr", "ai"]]))).toThrow(/at least 3/);
  });
});

describe("D10 late attendance is accepted but not applied to a running ballot", () => {
  it("late arrival during a vote cannot vote on it", () => {
    const sim = new Sim(makeState(SEATS()));
    sim.do(human("owner"), { type: "start" });
    for (const id of ["us", "fr", "de", "jp"]) sim.do(actorOf(id), { type: "declare_attendance", seat: id, value: "present" });
    sim.expire();
    sim.do(ai("fr"), { type: "submit_motion", seat: "fr", params: { type: "unmod_caucus", totalSec: 300 } });
    for (const id of ["us", "fr", "de", "jp"]) sim.try(actorOf(id), { type: "floor_pass", seat: id });
    sim.do(system, { type: "connection", seat: "gb", online: false });
    expectPhase(sim, "MOTION_VOTE"); // floor closed early: gb is not present, so not awaited
    sim.expire(); // reading → voting
    sim.do(human("u2"), { type: "declare_attendance", seat: "gb", value: "present" });
    const ballotId = (sim.phase as { ballotId: string }).ballotId;
    const r = sim.try(human("u2"), { type: "cast_vote", seat: "gb", ballotId, choice: "yes" });
    expect(r, JSON.stringify({ r, phase: sim.phase })).toMatchObject({ ok: false, code: "not_eligible" });
  });
});

describe("lobby seats", () => {
  it("humans replace AI seats; no duplicates; one seat per user; locked after start; owner keeps seat", () => {
    const sim = new Sim(makeState(seats([["us", "human", "owner"], ["gb", "ai"], ["fr", "ai"], ["de", "ai"]])));
    sim.do(human("u2"), { type: "claim_seat", seat: "gb" });
    expect(sim.s.seats.gb).toMatchObject({ kind: "human", uid: "u2" });
    expect(sim.try(human("u3"), { type: "claim_seat", seat: "gb" })).toMatchObject({ ok: false, code: "seat_taken" });
    expect(sim.try(human("u2"), { type: "claim_seat", seat: "fr" })).toMatchObject({ ok: false, code: "already_seated" });
    expect(sim.try(human("u2"), { type: "claim_seat", seat: "gb" })).toMatchObject({ ok: true, duplicate: true });
    expect(sim.try(human("owner"), { type: "release_seat", seat: "us" })).toMatchObject({ ok: false, code: "owner_seat" });
    sim.do(human("u2"), { type: "release_seat", seat: "gb" });
    expect(sim.s.seats.gb).toMatchObject({ kind: "ai" });
    sim.do(human("u3"), { type: "claim_seat", seat: "fr" });
    sim.do(human("owner"), { type: "start" });
    expect(sim.try(human("u4"), { type: "claim_seat", seat: "de" })).toMatchObject({ ok: false, code: "join_locked" });
    expect(sim.try(human("u3"), { type: "release_seat", seat: "fr" })).toMatchObject({ ok: false, code: "join_locked" });
    expect(sim.try(ai("de"), { type: "claim_seat", seat: "gb" })).toMatchObject({ ok: false, code: "humans_only" });
  });
});
