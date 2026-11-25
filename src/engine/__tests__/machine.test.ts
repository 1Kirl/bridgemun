import { describe, expect, it } from "vitest";
import { apply, availableActions } from "@/engine/machine";
import { dispositionAfterAdoption, MOTION_SPECS } from "@/engine/motions";
import type { MotionType, Phase } from "@/engine/types";
import { ai, expectPhase, human, makeState, seats, Sim, system } from "./helpers";

// us = room owner (a delegate, not the chair), gb = second human, fr/de/jp = AI
const SEATS = () =>
  seats([
    ["us", "human", "owner"],
    ["gb", "human", "u2"],
    ["fr", "ai"],
    ["de", "ai"],
    ["jp", "ai"],
  ]);

function started(policies = {}) {
  const sim = new Sim(makeState(SEATS(), policies));
  sim.do(human("owner"), { type: "start" });
  for (const id of ["fr", "de", "jp"]) sim.do(ai(id), { type: "declare_attendance", seat: id, value: "present" });
  sim.do(human("owner"), { type: "declare_attendance", seat: "us", value: "present" });
  sim.do(human("u2"), { type: "declare_attendance", seat: "gb", value: "present" });
  return sim; // all present → roll call ends early → FLOOR_OPEN (empty speakers list)
}

function passFloor(sim: Sim, except: string[] = []) {
  for (const id of ["us", "gb", "fr", "de", "jp"].filter((x) => !except.includes(x))) {
    const actor = id === "us" ? human("owner") : id === "gb" ? human("u2") : ai(id);
    sim.try(actor, { type: "floor_pass", seat: id });
  }
}
const actorOf = (id: string) => (id === "us" ? human("owner") : id === "gb" ? human("u2") : ai(id));

function voteAll(sim: Sim, choice: (seat: string) => "yes" | "no" | "abstain" | null) {
  const p = sim.phase as Extract<Phase, { type: "MOTION_VOTE" }>;
  if (p.stage === "reading") sim.expire();
  const ballotId = (sim.phase as { ballotId: string }).ballotId;
  for (const id of ["us", "gb", "fr", "de", "jp"]) {
    const c = choice(id);
    if (c && sim.phase.type !== "FLOOR_OPEN" && (sim.phase as { ballotId?: string }).ballotId === ballotId) {
      sim.do(actorOf(id), { type: "cast_vote", seat: id, ballotId, choice: c });
    }
  }
  return ballotId;
}

describe("room owner vs automatic chair", () => {
  it("only the owner can start; the owner cannot act for other seats or decide outcomes", () => {
    const sim = new Sim(makeState(SEATS()));
    expect(sim.try(human("u2"), { type: "start" })).toMatchObject({ ok: false, code: "owner_only" });
    sim.do(human("owner"), { type: "start" });
    expectPhase(sim, "ROLL_CALL");
    expect(sim.s.joinLocked).toBe(true);
    expect(sim.try(human("owner"), { type: "declare_attendance", seat: "gb", value: "present" })).toMatchObject({ ok: false, code: "forbidden_seat" });
    expect(sim.try(human("owner"), { type: "tick" })).toMatchObject({ ok: false, code: "system_only" });
    expect(sim.try(ai("fr"), { type: "declare_attendance", seat: "de", value: "present" })).toMatchObject({ ok: false, code: "forbidden_seat" });
  });
});

describe("roll call (rules 31–32)", () => {
  it("an unanswered human is NOT marked present; debate opens on quorum; late arrival allowed", () => {
    const sim = new Sim(makeState(SEATS()));
    sim.do(human("owner"), { type: "start" });
    for (const id of ["fr", "de", "jp"]) sim.do(ai(id), { type: "declare_attendance", seat: id, value: "present" });
    sim.do(human("owner"), { type: "declare_attendance", seat: "us", value: "present_and_voting" });
    sim.expire(); // gb never answered
    expect(sim.s.seats.gb.attendance).toBe("not_recorded");
    expectPhase(sim, "FLOOR_OPEN");
    expect(sim.try(human("u2"), { type: "submit_motion", seat: "gb", params: { type: "unmod_caucus", totalSec: 300 } })).toMatchObject({ ok: false, code: "not_present" });
    sim.do(human("u2"), { type: "declare_attendance", seat: "gb", value: "present" }); // rule 32: quorum may change as delegates arrive
    expect(sim.s.seats.gb.attendance).toBe("present");
    expect(sim.try(human("owner"), { type: "declare_attendance", seat: "us", value: "present" })).toMatchObject({ ok: false, code: "irrevocable" });
  });

  it("without debate quorum the roll call stays open", () => {
    const sim = new Sim(makeState(seats([["a", "human", "owner"], ["b", "human", "u2"], ["c", "human", "u3"], ["d", "human", "u4"], ["e", "human", "u5"]])));
    sim.do(human("owner"), { type: "start" });
    sim.do(human("owner"), { type: "declare_attendance", seat: "a", value: "present" }); // 1 of 5 < ceil(5/4)=2
    sim.expire();
    expectPhase(sim, "ROLL_CALL");
  });
});

describe("speeches, transcripts and AI context ordering", () => {
  it("next AI speech cannot be finalised before the human speech is confirmed, and stale drafts are rejected", () => {
    const sim = started();
    sim.do(human("owner"), { type: "add_to_speakers_list", seat: "us" });
    sim.do(ai("fr"), { type: "add_to_speakers_list", seat: "fr" });
    passFloor(sim);
    expectPhase(sim, "SPEECH_PREP");
    sim.expire();
    expectPhase(sim, "SPEECH");
    const ctxBefore = sim.s.contextSeq;
    // an AI that pre-generated now tries to speak: not its turn
    expect(sim.try(system, { type: "ai_speech_ready", seat: "fr", text: "pre", contextSeq: ctxBefore })).toMatchObject({ ok: false, stale: true });
    sim.do(human("owner"), { type: "end_speech", seat: "us" });
    expectPhase(sim, "SPEECH_CONFIRM");
    sim.do(system, { type: "transcript_result", seat: "us", ok: true, text: "We support verification." });
    expect(sim.try(system, { type: "ai_speech_ready", seat: "fr", text: "pre", contextSeq: ctxBefore })).toMatchObject({ ok: false });
    sim.do(human("owner"), { type: "confirm_transcript", seat: "us", text: "We support strict verification." });
    expect(sim.records().at(-1)).toMatchObject({ source: "human_voice_confirmed", text: "We support strict verification." });
    expect(sim.s.contextSeq).toBe(ctxBefore + 1);
    expectPhase(sim, "FLOOR_OPEN");
    passFloor(sim);
    expectPhase(sim, "AI_SPEECH_PENDING");
    // draft generated before the human speech was confirmed → must be regenerated
    expect(sim.try(system, { type: "ai_speech_ready", seat: "fr", text: "old", contextSeq: ctxBefore })).toMatchObject({ ok: false, code: "stale_context" });
    sim.do(system, { type: "ai_speech_ready", seat: "fr", text: "France responds to the United States on verification.", contextSeq: sim.s.contextSeq, audioId: "aud1", durationMs: 8000 });
    const p = sim.phase as Extract<Phase, { type: "SPEECH" }>;
    expect(p.ai?.playStartMs).toBe(sim.now + 1500); // generation latency is not charged to speaking time
    expect(p.deadlineMs - p.ai!.playStartMs).toBe(9000);
    // idempotent re-delivery
    expect(sim.try(system, { type: "ai_speech_ready", seat: "fr", text: "dup", contextSeq: p.ai!.contextSeq })).toMatchObject({ ok: true, duplicate: true });
    sim.expire();
    expect(sim.records().at(-1)).toMatchObject({ source: "ai_speech", seat: "fr" });
  });

  it("transcript failure → explicit skip; text speech replaces the voice turn; silent timeout waits once", () => {
    const sim = started();
    sim.do(human("owner"), { type: "add_to_speakers_list", seat: "us" });
    sim.do(human("u2"), { type: "add_to_speakers_list", seat: "gb" });
    sim.do(human("owner"), { type: "add_to_speakers_list", seat: "us" }); // duplicate → no-op
    expect(sim.s.speakersList).toEqual(["us", "gb"]);
    passFloor(sim);
    sim.expire();
    sim.do(human("owner"), { type: "end_speech", seat: "us" });
    sim.do(system, { type: "transcript_result", seat: "us", ok: false });
    sim.do(human("owner"), { type: "skip_transcript", seat: "us" });
    expect(sim.records().at(-1)).toMatchObject({ source: "human_no_transcript", substantive: false });
    passFloor(sim);
    sim.expire(); // gb prep → speech
    sim.do(human("u2"), { type: "submit_text_speech", seat: "gb", text: "Typed statement from the UK." });
    expect(sim.records().at(-1)).toMatchObject({ source: "human_text", substantive: true });
    // timeout path
    sim.do(human("owner"), { type: "add_to_speakers_list", seat: "us" });
    passFloor(sim);
    sim.expire();
    sim.expire(); // speech time over → confirm
    expectPhase(sim, "SPEECH_CONFIRM");
    sim.expire(); // transcript still pending → waits once
    expectPhase(sim, "SPEECH_CONFIRM");
    sim.expire();
    expect(sim.records().at(-1)).toMatchObject({ source: "human_no_transcript" });
    expectPhase(sim, "FLOOR_OPEN");
  });

  it("offline speaker forfeits (rule 16)", () => {
    const sim = started();
    sim.do(human("u2"), { type: "add_to_speakers_list", seat: "gb" });
    passFloor(sim);
    sim.do(system, { type: "connection", seat: "gb", online: false });
    sim.expire();
    expect(sim.records().at(-1)).toMatchObject({ source: "human_forfeit" });
  });
});

describe("floor window protects human time", () => {
  it("AI motions and AI passes do not close the window while online humans are not ready", () => {
    const sim = started();
    sim.do(ai("fr"), { type: "submit_motion", seat: "fr", params: { type: "unmod_caucus", totalSec: 300 } });
    for (const id of ["fr", "de", "jp"]) sim.do(ai(id), { type: "floor_pass", seat: id });
    expectPhase(sim, "FLOOR_OPEN");
    sim.do(human("owner"), { type: "floor_pass", seat: "us" });
    expectPhase(sim, "FLOOR_OPEN");
    sim.do(system, { type: "connection", seat: "gb", online: false }); // offline humans cannot block forever
    expectPhase(sim, "MOTION_VOTE"); // every remaining online human was ready
  });

  it("extensions are capped per window and per seat", () => {
    const sim = started();
    sim.do(human("owner"), { type: "request_extension", seat: "us" });
    sim.do(human("u2"), { type: "request_extension", seat: "gb" });
    expect(sim.try(human("owner"), { type: "request_extension", seat: "us" })).toMatchObject({ ok: false, code: "window_extension_limit" });
    expect(sim.try(ai("fr"), { type: "request_extension", seat: "fr" })).toMatchObject({ ok: false, code: "humans_only" });
  });
});

describe("motion precedence, adoption and remaining motions", () => {
  it("orders by rule 36, applies same-type app tie-break, and disposes remaining motions per table", () => {
    const sim = started();
    sim.do(human("owner"), { type: "submit_motion", seat: "us", params: { type: "set_speaking_time", speakingSec: 45 } });
    sim.do(ai("fr"), { type: "submit_motion", seat: "fr", params: { type: "mod_caucus", topic: "verification", speakingSec: 60, totalSec: 300 } });
    sim.do(ai("de"), { type: "submit_motion", seat: "de", params: { type: "mod_caucus", topic: "export controls", speakingSec: 30, totalSec: 600 } });
    sim.do(human("u2"), { type: "submit_motion", seat: "gb", params: { type: "unmod_caucus", totalSec: 300 } });
    // duplicate submission is idempotent
    expect(sim.try(human("u2"), { type: "submit_motion", seat: "gb", params: { type: "unmod_caucus", totalSec: 300 } })).toMatchObject({ ok: true, duplicate: true });
    passFloor(sim);
    const vote = sim.phase as Extract<Phase, { type: "MOTION_VOTE" }>;
    const order = [vote.currentMotionId, ...vote.queue].map((id) => sim.s.motions[id].params.type + ":" + sim.s.motions[id].mover);
    expect(order).toEqual(["unmod_caucus:gb", "mod_caucus:de", "mod_caucus:fr", "set_speaking_time:us"]);

    voteAll(sim, () => "no"); // unmod fails → next
    expect(sim.s.motions[vote.currentMotionId].status).toBe("rejected");
    voteAll(sim, () => "yes"); // mod 600/30 adopted
    const byMover = (m: string) => Object.values(sim.s.motions).find((x) => x.mover === m)!;
    expect(byMover("de").status).toBe("adopted");
    expect(byMover("fr")).toMatchObject({ status: "lapsed", disposition: { source: "rule_interpretation" } });
    expect(sim.s.carriedMotionIds).toEqual([byMover("us").id]); // open decision = carry over (policy A)
    expectPhase(sim, "MOD_CAUCUS");
  });

  it("moderated caucus charges full speaking time per speech and ends when nobody volunteers", () => {
    const sim = started();
    sim.do(ai("fr"), { type: "submit_motion", seat: "fr", params: { type: "mod_caucus", topic: "t", speakingSec: 60, totalSec: 120 } });
    passFloor(sim);
    voteAll(sim, () => "yes");
    sim.do(human("owner"), { type: "volunteer", seat: "us" });
    sim.do(ai("de"), { type: "volunteer", seat: "de" });
    sim.expire();
    expect((sim.phase as { seat: string }).seat).toBe("us"); // humans first among not-yet-spoken (app policy)
    sim.expire();
    sim.do(human("owner"), { type: "submit_text_speech", seat: "us", text: "short" }); // spoke 0s, still charged 60s
    expect(sim.s.activeCaucus?.usedSec).toBe(60);
    sim.expire(); // volunteer window, nobody → caucus ends (rule 10)
    expectPhase(sim, "FLOOR_OPEN");
    expect((sim.phase as Extract<Phase, { type: "FLOOR_OPEN" }>).origin).toBe("after_caucus");
    // extension ≤ half of original (rule 12)
    expect(sim.try(human("owner"), { type: "submit_motion", seat: "us", params: { type: "extend_caucus", durationSec: 61 } })).toMatchObject({ ok: false, code: "too_long" });
    sim.do(human("owner"), { type: "submit_motion", seat: "us", params: { type: "extend_caucus", durationSec: 60 } });
  });

  it("adjournment is dilatory early; when adopted, remaining motions become obsolete", () => {
    const sim = new Sim(makeState(SEATS(), {}, 10));
    sim.do(human("owner"), { type: "start" });
    for (const id of ["fr", "de", "jp"]) sim.do(ai(id), { type: "declare_attendance", seat: id, value: "present" });
    sim.do(human("owner"), { type: "declare_attendance", seat: "us", value: "present" });
    sim.do(human("u2"), { type: "declare_attendance", seat: "gb", value: "present" });
    expect(sim.try(human("owner"), { type: "submit_motion", seat: "us", params: { type: "adjourn" } })).toMatchObject({ ok: false, code: "dilatory" });
    sim.now += 9 * 60_000;
    sim.do(human("owner"), { type: "submit_motion", seat: "us", params: { type: "adjourn" } });
    sim.do(ai("fr"), { type: "submit_motion", seat: "fr", params: { type: "unmod_caucus", totalSec: 60 } });
    passFloor(sim);
    voteAll(sim, () => "yes");
    expectPhase(sim, "CLOSED");
    expect(Object.values(sim.s.motions).find((m) => m.mover === "fr")?.status).toBe("obsolete");
  });

  it("disposition table covers every adopted/other pair with a labelled source", () => {
    const types = Object.keys(MOTION_SPECS) as MotionType[];
    for (const a of types) for (const b of types) {
      const row = dispositionAfterAdoption(a, b);
      expect(["official", "rule_interpretation", "app_policy", "open_decision"]).toContain(row.source);
    }
  });
});

describe("ballots: versioning, idempotency, early close, disconnects", () => {
  function toVote(policies = {}) {
    const sim = started(policies);
    sim.do(human("owner"), { type: "submit_motion", seat: "us", params: { type: "unmod_caucus", totalSec: 300 } });
    passFloor(sim);
    sim.expire(); // reading → voting
    return sim;
  }

  it("another seat's vote does not invalidate an AI vote prepared for the same ballot", () => {
    const sim = toVote();
    const { ballotId } = sim.phase as { ballotId: string };
    const phaseAtDecision = sim.s.phaseId;
    sim.do(human("u2"), { type: "cast_vote", seat: "gb", ballotId, choice: "no" });
    // AI reasoned before gb voted; tied to ballot (not to eventSeq) → still valid
    expect(sim.try(ai("fr"), { type: "cast_vote", seat: "fr", ballotId, choice: "yes" }, { ballotId, phaseId: phaseAtDecision }).ok).toBe(true);
    expect(sim.try(ai("fr"), { type: "cast_vote", seat: "fr", ballotId, choice: "yes" })).toMatchObject({ ok: true, duplicate: true });
    expect(sim.try(ai("fr"), { type: "cast_vote", seat: "fr", ballotId, choice: "no" })).toMatchObject({ ok: false, code: "already_voted" });
    expect(sim.try(ai("de"), { type: "cast_vote", seat: "de", ballotId, choice: "abstain" })).toMatchObject({ ok: false, code: "choice_not_allowed" });
  });

  it("early close requires every eligible voter, including AI", () => {
    const sim = toVote();
    const { ballotId } = sim.phase as { ballotId: string };
    sim.do(human("owner"), { type: "cast_vote", seat: "us", ballotId, choice: "yes" });
    sim.do(human("u2"), { type: "cast_vote", seat: "gb", ballotId, choice: "yes" });
    expectPhase(sim, "MOTION_VOTE"); // humans done, AI not yet → stays open
    sim.do(ai("fr"), { type: "cast_vote", seat: "fr", ballotId, choice: "no" });
    sim.do(ai("de"), { type: "cast_vote", seat: "de", ballotId, choice: "no" });
    expectPhase(sim, "MOTION_VOTE");
    sim.do(ai("jp"), { type: "cast_vote", seat: "jp", ballotId, choice: "no" });
    expect(sim.s.ballots[ballotId].result).toMatchObject({ yes: 2, no: 3, passed: false });
  });

  it("disconnect during a vote keeps the electorate fixed and is reported", () => {
    const sim = toVote();
    const { ballotId } = sim.phase as { ballotId: string };
    sim.do(system, { type: "connection", seat: "gb", online: false });
    sim.do(human("owner"), { type: "cast_vote", seat: "us", ballotId, choice: "yes" });
    sim.expire();
    const r = sim.s.ballots[ballotId].result!;
    expect(r.eligibleCount).toBe(5);
    expect(r.notVotedOffline).toEqual(["gb"]);
    // D1: procedural vote needs Yes from more than half of the 5 fixed eligible seats → 1 Yes fails.
    expect(r).toMatchObject({ yes: 1, no: 0, passed: false });
  });

  it("policy extend_once: one extension for non-voters, then close", () => {
    const sim = toVote({ proceduralNonResponse: "extend_once_then_record_not_voting" });
    const { ballotId } = sim.phase as { ballotId: string };
    sim.expire();
    expect(sim.s.ballots[ballotId].extendedForNonResponse).toBe(true);
    expectPhase(sim, "MOTION_VOTE");
    sim.expire();
    expect(sim.s.ballots[ballotId].status).toBe("closed");
  });

  it("stale phase expectation is rejected", () => {
    const sim = toVote();
    const r = sim.try(ai("fr"), { type: "floor_pass", seat: "fr" }, { phaseId: "p1" });
    expect(r).toMatchObject({ ok: false, stale: true });
  });

  it("no voting quorum → motion not held (open decision applied explicitly)", () => {
    const sim = new Sim(makeState(SEATS()));
    sim.do(human("owner"), { type: "start" });
    sim.do(ai("fr"), { type: "declare_attendance", seat: "fr", value: "present" });
    sim.do(ai("de"), { type: "declare_attendance", seat: "de", value: "present" });
    sim.expire(); // 2 present ≥ debate quorum 2, < voting quorum 3
    sim.do(ai("fr"), { type: "submit_motion", seat: "fr", params: { type: "unmod_caucus", totalSec: 300 } });
    sim.expire();
    expect(Object.values(sim.s.motions)[0].status).toBe("not_held");
  });
});

describe("app pause", () => {
  it("owner only, preserves remaining time, auto-resumes at cap, and total cap applies", () => {
    const sim = started();
    const p = sim.phase as { deadlineMs: number };
    const remaining = p.deadlineMs - sim.now;
    expect(sim.try(human("u2"), { type: "app_pause" })).toMatchObject({ ok: false, code: "owner_only" });
    sim.do(human("owner"), { type: "app_pause" });
    expect(sim.try(human("u2"), { type: "floor_pass", seat: "gb" })).toMatchObject({ ok: false, code: "paused" });
    sim.advance(60_000);
    sim.do(human("owner"), { type: "app_resume" });
    expect((sim.phase as { deadlineMs: number }).deadlineMs - sim.now).toBe(remaining);
    sim.do(human("owner"), { type: "app_pause" });
    sim.expire(); // auto-resume after pauseMaxSec
    expect(sim.s.paused).toBeNull();
    expect(sim.s.usage.pauseUsedSec).toBe(360);
  });
});

describe("documents, amendments and final voting (text locked)", () => {
  it("runs WP→DR→introduction→unfriendly amendment→voting procedure→close", () => {
    const sim = started();
    sim.do(ai("fr"), { type: "submit_motion", seat: "fr", params: { type: "unmod_caucus", totalSec: 300 } });
    passFloor(sim);
    voteAll(sim, () => "yes");
    expectPhase(sim, "UNMOD_CAUCUS");
    sim.do(ai("fr"), { type: "submit_document", seat: "fr", kind: "draft_resolution", title: "Verification Framework", preambular: ["Recalling ..."], operative: ["Establishes ...", "Requests ..."] });
    const docId = Object.keys(sim.s.documents)[0];
    expect(sim.s.documents[docId].status).toBe("draft");
    sim.do(ai("de"), { type: "sign_document", seat: "de", docId, role: "sponsor" });
    sim.do(human("u2"), { type: "sign_document", seat: "gb", docId, role: "signatory" });
    expect(sim.s.documents[docId].status).toBe("approved"); // 2 sponsors, ceil(0.2×5)=1 signatory, clauses ok
    sim.expire(); // caucus ends
    sim.do(ai("de"), { type: "submit_motion", seat: "de", params: { type: "introduce_resolution" } });
    passFloor(sim);
    voteAll(sim, () => "yes");
    expectPhase(sim, "DR_INTRO");
    sim.expire();
    sim.expire();
    expectPhase(sim, "FLOOR_OPEN");
    // amendment
    sim.do(human("owner"), { type: "submit_amendment", seat: "us", targetDocId: docId, op: { kind: "replace", clauseIndex: 1, text: "Requests annual reports" } });
    const amId = Object.keys(sim.s.amendments)[0];
    sim.do(human("u2"), { type: "sign_amendment", amendmentId: amId, seat: "gb" });
    sim.do(ai("jp"), { type: "sign_amendment", amendmentId: amId, seat: "jp" });
    sim.do(human("owner"), { type: "submit_motion", seat: "us", params: { type: "introduce_amendment", amendmentId: amId } });
    passFloor(sim);
    voteAll(sim, () => "yes");
    expectPhase(sim, "AMENDMENT_SPONSOR_RESPONSE");
    sim.do(ai("fr"), { type: "sponsor_response", seat: "fr", amendmentId: amId, agree: true });
    sim.do(ai("de"), { type: "sponsor_response", seat: "de", amendmentId: amId, agree: false });
    expect(sim.s.amendments[amId].status).toBe("unfriendly_pending");
    // introduced text cannot be edited directly
    expect(sim.try(ai("fr"), { type: "update_document", seat: "fr", docId, preambular: ["x"], operative: ["y", "z"] })).toMatchObject({ ok: false, code: "locked" });
    sim.do(ai("fr"), { type: "submit_motion", seat: "fr", params: { type: "enter_voting" } });
    passFloor(sim);
    voteAll(sim, () => "yes");
    expectPhase(sim, "VOTING_PROCEDURE");
    // amendment ballot first, 2/3 substantive: 3 yes, 2 no → fails (3 < 4)
    sim.expire();
    let b = sim.s.ballots[(sim.phase as { ballotId: string }).ballotId];
    expect(b).toMatchObject({ kind: "substantive", threshold: "two_thirds" });
    for (const [id, c] of [["us", "yes"], ["gb", "yes"], ["jp", "yes"], ["fr", "no"], ["de", "no"]] as const) {
      sim.do(actorOf(id), { type: "cast_vote", seat: id, ballotId: b.id, choice: c });
    }
    expect(sim.s.amendments[amId].status).toBe("failed");
    // rule 33 window before the resolution vote; nobody moves to divide
    expectPhase(sim, "VP_FLOOR");
    sim.expire();
    // resolution ballot with locked text hash
    sim.expire();
    b = sim.s.ballots[(sim.phase as { ballotId: string }).ballotId];
    expect(b.subject).toMatchObject({ type: "resolution", docId, version: 1, textHash: sim.s.documents[docId].textHash });
    expect(sim.try(ai("fr"), { type: "cast_vote", seat: "fr", ballotId: b.id, choice: "yes" }, { ballotId: b.id, textHash: "different" })).toMatchObject({ ok: false, code: "stale_text" });
    for (const [id, c] of [["us", "abstain"], ["gb", "no"], ["jp", "yes"], ["fr", "yes"], ["de", "yes"]] as const) {
      sim.do(actorOf(id), { type: "cast_vote", seat: id, ballotId: b.id, choice: c });
    }
    expect(sim.s.documents[docId].status).toBe("adopted");
    expect(sim.phase).toMatchObject({ type: "CLOSED", reason: "voting_completed" });
  });
});

describe("misc", () => {
  it("voting-procedure motions are out of order during debate", () => {
    const sim = started();
    expect(sim.try(human("owner"), { type: "submit_motion", seat: "us", params: { type: "divide_question", docId: "d1" } })).toMatchObject({ ok: false, code: "not_in_order" });
    expect(sim.try(human("owner"), { type: "submit_motion", seat: "us", params: { type: "reorder_resolutions", order: ["d1"] } })).toMatchObject({ ok: false, code: "not_in_order" });
  });
  it("session end policy close_forum", () => {
    const sim = started();
    sim.now = sim.s.settings.sessionEndsAtMs + 1;
    sim.expire();
    expectPhase(sim, "CLOSED");
  });
  it("availableActions reflects the phase", () => {
    const sim = started();
    expect(availableActions(sim.s, "us")).toContain("submit_motion");
  });
  it("apply is pure (input state untouched)", () => {
    const sim = started();
    const before = JSON.stringify(sim.s);
    apply(sim.s, { actor: human("owner"), command: { type: "floor_pass", seat: "us" } }, sim.now);
    expect(JSON.stringify(sim.s)).toBe(before);
  });
});

describe("open decision variants are both executable", () => {
  function adoptCaucusWithPendingSpeakingTime(policy: "carry_over_to_next_window" | "lapse") {
    const sim = started({ remainingMotionsAfterModeChange: policy });
    sim.do(human("owner"), { type: "submit_motion", seat: "us", params: { type: "set_speaking_time", speakingSec: 45 } });
    sim.do(ai("fr"), { type: "submit_motion", seat: "fr", params: { type: "unmod_caucus", totalSec: 60 } });
    passFloor(sim);
    voteAll(sim, () => "yes"); // unmod adopted first (precedence 4 < 6)
    expectPhase(sim, "UNMOD_CAUCUS");
    sim.expire(); // caucus over → new floor window
    expectPhase(sim, "FLOOR_OPEN");
    return sim;
  }
  it("carry_over: the pending motion is voted first in the next window", () => {
    const sim = adoptCaucusWithPendingSpeakingTime("carry_over_to_next_window");
    passFloor(sim);
    const p = sim.phase as Extract<Phase, { type: "MOTION_VOTE" }>;
    expect(sim.s.motions[p.currentMotionId].params.type).toBe("set_speaking_time");
    voteAll(sim, () => "yes");
    expect(sim.s.speakingTimeSec).toBe(45);
  });
  it("lapse: the pending motion is dropped and must be resubmitted", () => {
    const sim = adoptCaucusWithPendingSpeakingTime("lapse");
    const st = Object.values(sim.s.motions).find((m) => m.params.type === "set_speaking_time")!;
    expect(st).toMatchObject({ status: "lapsed", disposition: { source: "open_decision" } });
    passFloor(sim);
    expect(sim.phase.type).not.toBe("MOTION_VOTE");
  });
  it("policies are mandatory: a forum cannot be created with an unset decision", () => {
    expect(() => makeState(SEATS(), { sessionEnd: undefined as never })).toThrow(/Open rule decisions not set/);
  });
});

describe("AI speech timeout", () => {
  it("no usable draft in time → turn skipped and recorded, debate continues", () => {
    const sim = started();
    sim.do(ai("jp"), { type: "add_to_speakers_list", seat: "jp" });
    passFloor(sim);
    expectPhase(sim, "AI_SPEECH_PENDING");
    sim.expire();
    expect(sim.records().at(-1)).toMatchObject({ source: "ai_unavailable", substantive: false });
    expectPhase(sim, "FLOOR_OPEN");
  });
});
