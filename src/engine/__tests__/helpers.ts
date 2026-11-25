import { expect } from "vitest";
import { apply, createForumState, defaultSettingsBase } from "@/engine/machine";
import { APP_DEFAULT_POLICIES, type OpenPolicies } from "@/engine/policies";
import type { Actor, Command, Effect, Expectation, ForumEngineState, Seat } from "@/engine/types";

export const T0 = Date.UTC(2026, 10, 25, 9, 0, 0);

export const POLICIES_A: OpenPolicies = {
  proceduralNonResponse: "record_not_voting",
  substantiveNonResponse: "record_not_voting",
  remainingMotionsAfterModeChange: "carry_over_to_next_window",
  enterVotingThreshold: "simple_majority",
  amendmentSponsorSilence: "treated_as_not_agreeing",
  sessionEnd: "close_forum",
  noVotingQuorum: "record_not_held",
};

export function seats(spec: Array<[string, "human" | "ai", string?]>): Seat[] {
  return spec.map(([id, kind, uid]) => ({
    id,
    countryName: id.toUpperCase(),
    kind,
    uid,
    attendance: "not_recorded",
    connection: "online",
  }));
}

export function makeState(seatList: Seat[], policies: Partial<OpenPolicies> = {}, sessionMin = 120): ForumEngineState {
  return createForumState({
    forumId: "f1",
    committeeId: "DISEC",
    ownerUid: "owner",
    seats: seatList,
    settings: {
      ...defaultSettingsBase(),
      sessionDurationSec: sessionMin * 60,
      sessionStartMs: T0,
      sessionEndsAtMs: T0 + sessionMin * 60_000,
      // Default = the product owner's decided app policies (D1–D7). Variant tests override explicitly.
      policies: { ...APP_DEFAULT_POLICIES, ...policies },
    },
  });
}

export const human = (uid: string): Actor => ({ kind: "human", uid });
export const ai = (seat: string): Actor => ({ kind: "ai", seat });
export const system: Actor = { kind: "system" };

/** Mutable harness with a fake server clock. */
export class Sim {
  now = T0;
  effects: Effect[] = [];
  constructor(public s: ForumEngineState) {}

  do(actor: Actor, command: Command, expect?: Expectation) {
    const r = apply(this.s, { actor, command, expect }, this.now);
    if (!r.ok) throw new Error(`rejected ${command.type}: ${r.code} ${r.message}`);
    this.s = r.state;
    this.effects.push(...r.effects);
    return r;
  }
  try(actor: Actor, command: Command, expect?: Expectation) {
    const r = apply(this.s, { actor, command, expect }, this.now);
    if (r.ok) {
      this.s = r.state;
      this.effects.push(...r.effects);
    }
    return r;
  }
  /** Advance the clock to the current phase deadline (+1ms) and deliver the scheduler tick. */
  expire() {
    const p = this.s.phase as { deadlineMs?: number; resumeAtMs?: number };
    const d = this.s.paused ? this.s.paused.autoResumeAtMs : (p.deadlineMs ?? p.resumeAtMs);
    if (d === undefined) throw new Error(`phase ${this.s.phase.type} has no deadline`);
    this.now = Math.max(this.now, d);
    return this.do(system, { type: "tick" }, { phaseId: this.s.phaseId });
  }
  advance(ms: number) {
    this.now += ms;
  }
  get phase() {
    return this.s.phase;
  }
  records() {
    return this.effects.flatMap((e) => (e.type === "record" ? [e.entry] : []));
  }
}

export function expectPhase(sim: Sim, type: string) {
  expect(sim.phase.type).toBe(type);
}
