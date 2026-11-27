import { describe, expect, it } from "vitest";
import { allowedChoices, checkVote, debateQuorumRequired, openBallot, tally, votingQuorumRequired } from "@/engine/voting";
import type { Seat, VoteChoice } from "@/engine/types";

function mkSeats(n: number, present: number, pv: number[] = []): Record<string, Seat> {
  const out: Record<string, Seat> = {};
  for (let i = 0; i < n; i++) {
    const id = `s${i}`;
    out[id] = {
      id,
      countryName: id,
      kind: i % 2 ? "ai" : "human",
      attendance: i < present ? (pv.includes(i) ? "present_and_voting" : "present") : "not_recorded",
      connection: "online",
    };
  }
  return out;
}

describe("rule 32 quorum (official)", () => {
  // members → [debate quorum ceil(n/4), voting quorum floor(n/2)+1]
  const table: Array<[number, number, number]> = [
    [1, 1, 1], [2, 1, 2], [3, 1, 2], [4, 1, 3], [5, 2, 3], [7, 2, 4], [8, 2, 5], [10, 3, 6], [15, 4, 8], [30, 8, 16], [50, 13, 26],
  ];
  it.each(table)("%i members → debate %i, voting %i", (n, dq, vq) => {
    expect(debateQuorumRequired(n)).toBe(dq);
    expect(votingQuorumRequired(n)).toBe(vq);
  });

  it("ballot is not held below voting quorum (boundary)", () => {
    expect(openBallot({ id: "b", kind: "procedural", threshold: "simple_majority", subject: { type: "motion", motionId: "m" }, seats: mkSeats(8, 4), nowMs: 0 }).status).toBe("not_held");
    expect(openBallot({ id: "b", kind: "procedural", threshold: "simple_majority", subject: { type: "motion", motionId: "m" }, seats: mkSeats(8, 5), nowMs: 0 }).status).toBe("reading");
  });
});

function ballotWith(votes: Array<VoteChoice | null>, threshold: "simple_majority" | "two_thirds" = "simple_majority", kind: "procedural" | "substantive" = "substantive") {
  const n = votes.length;
  const b = openBallot({ id: "b", kind, threshold, subject: { type: "motion", motionId: "m" }, seats: mkSeats(n, n), nowMs: 0 });
  b.status = "open";
  votes.forEach((v, i) => {
    if (v) b.votes[`s${i}`] = v;
  });
  return b;
}
const online = {};

describe("rule 35 thresholds (official) + zero-vote guard (app)", () => {
  const cases: Array<[string, Array<VoteChoice | null>, "simple_majority" | "two_thirds", boolean]> = [
    ["0-0 simple fails", [null, null, null], "simple_majority", false],
    ["0-0 with abstentions fails", ["abstain", "abstain"], "simple_majority", false],
    ["1-0 simple passes", ["yes", null, null], "simple_majority", true],
    ["2-2 tie fails", ["yes", "yes", "no", "no"], "simple_majority", false],
    ["3-2 passes, abstain ignored", ["yes", "yes", "yes", "no", "no", "abstain", "abstain"], "simple_majority", true],
    ["2/3: 0-0 fails (app guard)", [null, "abstain"], "two_thirds", false],
    ["2/3: 2-1 passes (exactly twice)", ["yes", "yes", "no"], "two_thirds", true],
    ["2/3: 3-2 fails", ["yes", "yes", "yes", "no", "no"], "two_thirds", false],
    ["2/3: 4-2 passes", ["yes", "yes", "yes", "yes", "no", "no"], "two_thirds", true],
    ["2/3: 1-0 passes", ["yes", null], "two_thirds", true],
  ];
  it.each(cases)("%s", (_n, votes, th, expected) => {
    expect(tally(ballotWith(votes, th), "record_not_voting", online).passed).toBe(expected);
  });

  it("non-voters are reported separately and never counted as abstentions", () => {
    const r = tally(ballotWith(["yes", "no", null, null, "abstain"]), "record_not_voting", { s2: "offline" });
    expect(r).toMatchObject({ yes: 1, no: 1, abstain: 1, eligibleCount: 5, notVoted: ["s2", "s3"], notVotedOffline: ["s2"] });
  });

  it("policy require_majority_of_eligible uses the fixed electorate as denominator", () => {
    // 10 eligible, 4 yes 1 no, 5 silent: passes under rule-35 formula, fails under eligible-majority variant
    const v: Array<VoteChoice | null> = ["yes", "yes", "yes", "yes", "no", null, null, null, null, null];
    expect(tally(ballotWith(v), "record_not_voting", online).passed).toBe(true);
    expect(tally(ballotWith(v), "require_majority_of_eligible", online).passed).toBe(false);
    const v2: Array<VoteChoice | null> = ["yes", "yes", "yes", "yes", "yes", "yes", null, null, null, null];
    expect(tally(ballotWith(v2), "require_majority_of_eligible", online).passed).toBe(true);
  });
});

describe("rules 30–31 choices", () => {
  it("procedural: no abstention", () => {
    const b = ballotWith([null, null], "simple_majority", "procedural");
    expect(allowedChoices(b, "s0")).toEqual(["yes", "no"]);
    expect(checkVote(b, "s0", "abstain")).toMatchObject({ ok: false, code: "choice_not_allowed" });
  });
  it("substantive: present may abstain, present-and-voting may not", () => {
    const seats = mkSeats(3, 3, [1]);
    const b = openBallot({ id: "b", kind: "substantive", threshold: "simple_majority", subject: { type: "motion", motionId: "m" }, seats, nowMs: 0 });
    b.status = "open";
    expect(checkVote(b, "s0", "abstain").ok).toBe(true);
    expect(checkVote(b, "s1", "abstain")).toMatchObject({ ok: false, code: "choice_not_allowed" });
  });
  it("seats absent at open are not eligible even if they arrive later", () => {
    const seats = mkSeats(4, 3);
    const b = openBallot({ id: "b", kind: "procedural", threshold: "simple_majority", subject: { type: "motion", motionId: "m" }, seats, nowMs: 0 });
    b.status = "open";
    seats.s3.attendance = "present";
    expect(checkVote(b, "s3", "yes")).toMatchObject({ ok: false, code: "not_eligible" });
    expect(Object.keys(b.eligible)).toHaveLength(3);
  });
});

describe("tally text never shows an unmet rule as if it were met", () => {
  it("a failed ballot's formula says 'not met'; a passed one does not", async () => {
    const { tally } = await import("@/engine/voting");
    const mk = (votes: Record<string, "yes" | "no" | "abstain">, threshold: "simple" | "two_thirds") =>
      ({ id: "b", kind: "substantive", threshold, status: "closed", eligible: { a: true, b: true, c: true, d: true, e: true, f: true }, votes, voted: Object.keys(votes), quorumMet: true, presentAtOpen: 6, quorumRequired: 4, openedAtMs: 0, subject: { type: "motion", motionId: "m" } }) as never;
    const failed = tally(mk({ a: "yes", b: "yes", c: "yes", d: "no", e: "no", f: "abstain" }, "two_thirds"), "record_not_voting", {});
    expect(failed.passed).toBe(false);
    expect(failed.formula).toMatch(/not met$/);
    const ok = tally(mk({ a: "yes", b: "yes", c: "yes", d: "yes", e: "no", f: "abstain" }, "two_thirds"), "record_not_voting", {});
    expect(ok.passed).toBe(true);
    expect(ok.formula).not.toMatch(/not met/);
  });
});
