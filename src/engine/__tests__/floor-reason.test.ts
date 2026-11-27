/**
 * FLOOR_OPEN.reason — why the floor is open (display only). It must match what actually happened and must not
 * change any transition. Controlled clock.
 */
import { describe, expect, it } from "vitest";
import type { Phase } from "@/engine/types";
import { ai, human, makeState, seats, Sim, system } from "./helpers";

const UID: Record<string, string> = { h1: "owner", h2: "u2" };
const actorOf = (id: string) => (UID[id] ? human(UID[id]) : ai(id));
const ALL = ["a0", "a1", "a2", "h1", "h2"];

function started() {
  const s = makeState(
    seats([
      ["h1", "human", "owner"],
      ["h2", "human", "u2"],
      ["a0", "ai"],
      ["a1", "ai"],
      ["a2", "ai"],
    ]),
  );
  s.settings.timers.responseWaitSec = 300;
  const sim = new Sim(s);
  sim.do(human("owner"), { type: "start" });
  for (const id of ALL) sim.do(actorOf(id), { type: "declare_attendance", seat: id, value: "present" });
  return sim;
}
const floor = (sim: Sim) => sim.phase as Extract<Phase, { type: "FLOOR_OPEN" }>;
const allPass = (sim: Sim) => {
  for (const id of ALL) sim.do(actorOf(id), { type: "floor_pass", seat: id });
};

describe("FLOOR_OPEN.reason", () => {
  it("roll call complete → debate_opened", () => {
    const sim = started();
    expect(sim.phase.type).toBe("FLOOR_OPEN");
    expect(floor(sim).reason).toBe("debate_opened");
  });

  it("previous window closed with no motion → no_motions (and the general debate flow is unchanged)", () => {
    const sim = started();
    const first = floor(sim).windowId;
    allPass(sim);
    expect(sim.phase.type).toBe("FLOOR_OPEN");
    expect(floor(sim).windowId).not.toBe(first);
    expect(floor(sim).reason).toBe("no_motions");
  });

  it("a motion voted down → no_motion_adopted, not no_motions", () => {
    const sim = started();
    sim.do(ai("a0"), { type: "submit_motion", seat: "a0", params: { type: "unmod_caucus", totalSec: 300 } });
    allPass(sim);
    sim.expire(); // reading
    const b = (sim.phase as { ballotId: string }).ballotId;
    for (const id of ALL) sim.do(actorOf(id), { type: "cast_vote", seat: id, ballotId: b, choice: "no" });
    expect(sim.phase.type).toBe("FLOOR_OPEN");
    expect(floor(sim).reason).toBe("no_motion_adopted");
  });

  it("after a speech from the speakers' list → speech_ended", () => {
    const sim = started();
    sim.do(ai("a1"), { type: "add_to_speakers_list", seat: "a1" });
    allPass(sim);
    sim.do(ai("a1"), { type: "ai_speech_ready", seat: "a1", text: "Statement.", contextSeq: sim.s.contextSeq });
    sim.expire();
    expect(sim.phase.type).toBe("FLOOR_OPEN");
    expect(floor(sim).reason).toBe("speech_ended");
  });

  it("a human's floor_pass after the reason is set never changes it; ticks keep it", () => {
    const sim = started();
    sim.do(human("u2"), { type: "floor_pass", seat: "h2" });
    expect(floor(sim).reason).toBe("debate_opened");
    sim.advance(1000);
    sim.try(system, { type: "tick" }, { phaseId: sim.s.phaseId });
    expect(floor(sim).reason).toBe("debate_opened");
  });

  it("a delegate who said 'no motion' may still move a motion while the window is open (Change response)", () => {
    const sim = started();
    sim.do(human("u2"), { type: "floor_pass", seat: "h2" });
    const r = sim.try(human("u2"), { type: "submit_motion", seat: "h2", params: { type: "unmod_caucus", totalSec: 300 } });
    expect(r.ok).toBe(true);
    expect(Object.values(sim.s.motions).some((m) => m.mover === "h2" && m.status === "pending")).toBe(true);
  });
});
