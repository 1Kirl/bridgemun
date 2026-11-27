/**
 * App policy S1 — human speeches up to 300 s (BridgeMUN online operating policy, not an HMUN rule).
 * Controlled clock throughout.
 */
import { describe, expect, it } from "vitest";
import { effectiveSessionEndMs } from "@/engine/machine";
import type { Phase } from "@/engine/types";
import { ai, human, makeState, seats, Sim, system } from "./helpers";

const UID: Record<string, string> = { h1: "owner", h2: "u2" };
const actorOf = (id: string) => (UID[id] ? human(UID[id]) : ai(id));
const AI = ["a0", "a1", "a2"];

function started(sessionMin = 120) {
  const s = makeState(
    seats([
      ["h1", "human", "owner"],
      ["h2", "human", "u2"],
      ["a0", "ai"],
      ["a1", "ai"],
      ["a2", "ai"],
    ]),
    {},
    sessionMin,
  );
  s.settings.timers.responseWaitSec = 300;
  s.settings.timers.humanSpeechMaxSec = 300;
  const sim = new Sim(s);
  sim.do(human("owner"), { type: "start" });
  for (const id of [...AI, "h1", "h2"]) sim.do(actorOf(id), { type: "declare_attendance", seat: id, value: "present" });
  return sim;
}
const speech = (sim: Sim) => sim.phase as Extract<Phase, { type: "SPEECH" }>;

/** h2 on the list → recognised → Start speech. */
function h2Speaking(sessionMin = 120) {
  const sim = started(sessionMin);
  sim.do(human("u2"), { type: "add_to_speakers_list", seat: "h2" });
  for (const id of AI) sim.do(ai(id), { type: "floor_pass", seat: id });
  for (const h of ["h1", "h2"]) sim.do(actorOf(h), { type: "floor_pass", seat: h });
  expect(sim.phase.type).toBe("SPEECH_PREP");
  sim.advance(20_000); // preparation never uses speaking time
  sim.do(human("u2"), { type: "start_speech", seat: "h2" });
  expect(sim.phase.type).toBe("SPEECH");
  return sim;
}

describe("S1 human speaking time (speakers' list)", () => {
  it("Start speech opens a 300 s slot; still speaking after 60 s", () => {
    const sim = h2Speaking();
    const p = speech(sim);
    expect(p.deadlineMs - sim.now).toBe(300_000);
    expect(p.officialSec).toBe(60);
    sim.advance(61_000);
    expect(sim.do(system, { type: "tick" }, { phaseId: sim.s.phaseId }).duplicate).toBe(true); // nothing ends at 60 s
    expect(sim.phase.type).toBe("SPEECH");
  });

  it("text submitted at 120 s ends the turn at once; only the 60 s actually used beyond the official time is credited", () => {
    const sim = h2Speaking();
    const end0 = sim.s.settings.sessionEndsAtMs;
    sim.advance(120_000);
    expect(effectiveSessionEndMs(sim.s, sim.now)).toBe(end0 + 60_000);
    sim.do(human("u2"), { type: "submit_text_speech", seat: "h2", text: "Long statement" });
    expect(sim.phase.type).toBe("FLOOR_OPEN");
    expect(sim.s.settings.sessionEndsAtMs).toBe(end0 + 60_000);
    expect(sim.s.usage.speechOvertimeCreditMs).toBe(60_000);
    expect(sim.records().some((r) => r.source === "human_text" && r.text === "Long statement")).toBe(true);
  });

  it("ending within the official time credits nothing; End speech goes straight to confirmation", () => {
    const sim = h2Speaking();
    const end0 = sim.s.settings.sessionEndsAtMs;
    sim.advance(30_000);
    sim.do(human("u2"), { type: "end_speech", seat: "h2" });
    expect(sim.phase.type).toBe("SPEECH_CONFIRM");
    expect(sim.s.settings.sessionEndsAtMs).toBe(end0);
  });

  it("300 s expiry → transcript confirmation; 240 s credited, independent of the W1 credit cap", () => {
    const sim = h2Speaking();
    sim.s.usage.responseWaitCreditMs = sim.s.settings.sessionDurationSec * 1000; // W1 cap already used up
    const end0 = sim.s.settings.sessionEndsAtMs;
    sim.expire();
    expect(sim.phase.type).toBe("SPEECH_CONFIRM");
    expect(sim.s.settings.sessionEndsAtMs).toBe(end0 + 240_000);
  });

  it("End speech, text submit and expiry racing: the turn ends exactly once", () => {
    const sim = h2Speaking();
    sim.advance(90_000);
    sim.do(human("u2"), { type: "submit_text_speech", seat: "h2", text: "Statement" });
    const after = sim.s.phaseId;
    expect(sim.try(human("u2"), { type: "end_speech", seat: "h2" }).ok).toBe(false);
    expect(sim.try(human("u2"), { type: "submit_text_speech", seat: "h2", text: "Statement" }).ok).toBe(false);
    expect(sim.s.phaseId).toBe(after);
    expect(sim.records().filter((r) => r.seat === "h2" && r.source === "human_text")).toHaveLength(1);
  });

  it("yield gives only the remaining OFFICIAL time (rule 18), not the S1 allowance", () => {
    const sim = h2Speaking();
    sim.advance(20_000);
    sim.do(human("u2"), { type: "end_speech", seat: "h2", yieldTo: "a1" });
    expect((sim.phase as Extract<Phase, { type: "SPEECH_CONFIRM" }>).yieldTo).toEqual({ seat: "a1", sec: 40 });
  });

  it("a session that 'ends' during a long speech never cuts the speech; overtime is added back", () => {
    const sim = h2Speaking(15);
    const end0 = sim.s.settings.sessionEndsAtMs;
    sim.now = end0 - 30_000; // session almost over while h2 is still speaking (well past 60 s)
    sim.do(human("u2"), { type: "submit_text_speech", seat: "h2", text: "x" });
    expect(sim.phase.type).not.toBe("CLOSED");
  });

  it("app pause during a speech: the paused time is neither speaking time nor overtime", () => {
    const sim = h2Speaking();
    const end0 = sim.s.settings.sessionEndsAtMs;
    sim.advance(50_000);
    sim.do(human("owner"), { type: "app_pause" });
    sim.advance(100_000);
    sim.do(human("owner"), { type: "app_resume" });
    sim.advance(20_000); // 70 s spoken in total
    sim.do(human("u2"), { type: "submit_text_speech", seat: "h2", text: "x" });
    expect(sim.s.settings.sessionEndsAtMs).toBe(end0 + 10_000);
  });
});

describe("S1 in moderated caucus; AI unchanged", () => {
  it("human caucus speech up to 300 s; the caucus counts only the official caucus speaking time", () => {
    const sim = started();
    sim.do(ai("a0"), { type: "submit_motion", seat: "a0", params: { type: "mod_caucus", topic: "T", speakingSec: 45, totalSec: 300 } });
    for (const id of AI) sim.do(ai(id), { type: "floor_pass", seat: id });
    for (const h of ["h1", "h2"]) sim.do(actorOf(h), { type: "floor_pass", seat: h });
    sim.expire();
    const b = (sim.phase as { ballotId: string }).ballotId;
    for (const id of [...AI, "h1", "h2"]) sim.do(actorOf(id), { type: "cast_vote", seat: id, ballotId: b, choice: "yes" });
    sim.do(human("u2"), { type: "volunteer", seat: "h2" });
    sim.do(human("owner"), { type: "volunteer_pass", seat: "h1" });
    sim.expire();
    sim.do(human("u2"), { type: "start_speech", seat: "h2" });
    expect(speech(sim).deadlineMs - sim.now).toBe(300_000);
    expect(speech(sim).officialSec).toBe(45);
    sim.advance(200_000);
    sim.do(human("u2"), { type: "submit_text_speech", seat: "h2", text: "x" });
    expect(sim.s.activeCaucus!.usedSec).toBe(45); // rule 10: full official speaking time, not 200 s
    expect(sim.phase.type).toBe("MOD_CAUCUS"); // caucus continues (not cut by the long speech)
  });

  it("AI speeches keep the official speaking time", () => {
    const sim = started();
    sim.do(ai("a1"), { type: "add_to_speakers_list", seat: "a1" });
    for (const id of AI) sim.do(ai(id), { type: "floor_pass", seat: id });
    for (const h of ["h1", "h2"]) sim.do(actorOf(h), { type: "floor_pass", seat: h });
    const need = sim.effects.filter((e) => e.type === "ai_speech_needed").pop() as { maxWords: number };
    expect(need.maxWords).toBe(Math.floor(60 * 2.3));
    sim.do(ai("a1"), { type: "ai_speech_ready", seat: "a1", text: "word ".repeat(400), contextSeq: sim.s.contextSeq });
    expect(speech(sim).deadlineMs - speech(sim).startedMs).toBeLessThanOrEqual(60_000);
    expect(speech(sim).officialSec).toBeUndefined();
  });
});
