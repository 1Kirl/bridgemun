import type { NonResponsePolicy } from "@/engine/policies";
import type {
  Ballot,
  BallotKind,
  BallotSubject,
  Seat,
  SeatId,
  TallyResult,
  Threshold,
  VoteChoice,
} from "@/engine/types";

/** Rule 32 (official): debate may open when at least one-fourth of the voting members are present. */
export function debateQuorumRequired(members: number): number {
  return Math.ceil(members / 4);
}

/** Rule 32 (official): any voting requires the presence of a simple majority of the members. */
export function votingQuorumRequired(members: number): number {
  return Math.floor(members / 2) + 1;
}

export function isPresent(seat: Seat): boolean {
  return seat.attendance === "present" || seat.attendance === "present_and_voting";
}

/**
 * Opens a ballot and FREEZES its electorate: every seat recorded present at this instant.
 * Later disconnects, late arrivals or attendance changes do not alter `eligible`.
 */
export function openBallot(args: {
  id: string;
  kind: BallotKind;
  threshold: Threshold;
  subject: BallotSubject;
  seats: Record<SeatId, Seat>;
  nowMs: number;
}): Ballot {
  const all = Object.values(args.seats);
  const present = all.filter(isPresent);
  const eligible: Ballot["eligible"] = {};
  for (const s of present) eligible[s.id] = { attendance: s.attendance, kind: s.kind };
  const quorumRequired = votingQuorumRequired(all.length);
  const quorumMet = present.length >= quorumRequired;
  return {
    id: args.id,
    kind: args.kind,
    threshold: args.threshold,
    subject: args.subject,
    openedAtMs: args.nowMs,
    eligible,
    membersTotal: all.length,
    presentAtOpen: present.length,
    quorumRequired,
    quorumMet,
    votes: {},
    status: quorumMet ? "reading" : "not_held",
    extendedForNonResponse: false,
    extensionUsedSec: 0,
  };
}

export type VoteCheck = { ok: true } | { ok: false; code: string; message: string };

/** Which choices a seat may cast. Rule 30 (procedural: yes/no) + rule 31 (present and voting: no abstain). */
export function allowedChoices(ballot: Ballot, seat: SeatId): VoteChoice[] {
  const e = ballot.eligible[seat];
  if (!e) return [];
  if (ballot.kind === "procedural") return ["yes", "no"];
  return e.attendance === "present_and_voting" ? ["yes", "no"] : ["yes", "no", "abstain"];
}

export function checkVote(ballot: Ballot, seat: SeatId, choice: VoteChoice): VoteCheck {
  if (ballot.status !== "open") return { ok: false, code: "ballot_not_open", message: `Ballot is ${ballot.status}` };
  if (!ballot.eligible[seat]) return { ok: false, code: "not_eligible", message: "Seat was not present when voting opened" };
  if (!allowedChoices(ballot, seat).includes(choice)) {
    return {
      ok: false,
      code: "choice_not_allowed",
      message:
        ballot.kind === "procedural"
          ? "Procedural votes allow only Yes or No (rule 30)"
          : "Delegations 'present and voting' cannot abstain (rule 31)",
    };
  }
  const existing = ballot.votes[seat];
  if (existing && existing !== choice) {
    return { ok: false, code: "already_voted", message: "Votes cannot be changed once cast (app policy)" };
  }
  return { ok: true };
}

/** Early close is allowed only when EVERY eligible voter — human and AI — has a valid vote. */
export function allEligibleVoted(ballot: Ballot): boolean {
  const seats = Object.keys(ballot.eligible);
  return seats.length > 0 && seats.every((s) => ballot.votes[s] !== undefined);
}

export function pendingVoters(ballot: Ballot): SeatId[] {
  return Object.keys(ballot.eligible).filter((s) => ballot.votes[s] === undefined);
}

/**
 * Rule 35 (official): simple majority = more Yes than No, abstentions not counted;
 * two-thirds = at least twice as many Yes as No.
 * App guard (user requirement): a motion with zero Yes votes never passes (otherwise 0–0 would satisfy 2/3).
 */
export function tally(
  ballot: Ballot,
  policy: NonResponsePolicy,
  connection: Record<SeatId, "online" | "offline">,
): TallyResult {
  let yes = 0;
  let no = 0;
  let abstain = 0;
  for (const [seat, v] of Object.entries(ballot.votes)) {
    if (!ballot.eligible[seat]) continue;
    if (v === "yes") yes++;
    else if (v === "no") no++;
    else abstain++;
  }
  const eligibleCount = Object.keys(ballot.eligible).length;
  const notVoted = pendingVoters(ballot);
  const notVotedOffline = notVoted.filter((s) => connection[s] === "offline");

  let passed: boolean;
  let formula: string;
  if (policy === "require_majority_of_eligible") {
    if (ballot.threshold === "two_thirds") {
      passed = yes >= 1 && 3 * yes >= 2 * eligibleCount;
      formula = `yes(${yes}) ≥ 2/3 × eligible(${eligibleCount})`;
    } else {
      passed = 2 * yes > eligibleCount;
      formula = `yes(${yes}) > eligible(${eligibleCount})/2`;
    }
  } else if (ballot.threshold === "two_thirds") {
    passed = yes >= 1 && yes >= 2 * no;
    formula = `yes(${yes}) ≥ 2 × no(${no}) and yes ≥ 1`;
  } else {
    passed = yes > no;
    formula = `yes(${yes}) > no(${no})`;
  }
  return { yes, no, abstain, eligibleCount, notVoted, notVotedOffline, passed, formula };
}
