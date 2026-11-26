/**
 * App policy W1 — "wait for required human responses" (BridgeMUN online operating policy, NOT an HMUN rule).
 *
 * For each phase this module says WHICH humans must respond, WHAT counts as their response, and what the
 * engine does when the response window expires. It is pure and shared by the engine (decisions) and the UI
 * (who is still awaited), so both always agree. Ballot choices are never needed: only who has voted.
 */
import { isPresent } from "@/engine/voting";
import type { DocumentState, Amendment, CaucusState, Phase, ResponseWait, Seat, SeatId, SeatKind } from "@/engine/types";

export type ResponseKind =
  | "attendance"
  | "start_speech"
  | "confirm_transcript"
  | "motion"
  | "voting_motion"
  | "division"
  | "vote"
  | "volunteer"
  | "sponsor"
  | "caucus_ready";

export type ResponseView = {
  kind: ResponseKind;
  /** Humans whose response this phase needs. */
  required: SeatId[];
  responded: SeatId[];
  pending: SeatId[];
  /** true: the engine holds the phase for pending (online) humans up to the response deadline. */
  holds: boolean;
  wait?: ResponseWait;
  /** Responded through an earlier, still-valid choice (standing "no motion", pass for the rest of the caucus). */
  standing: SeatId[];
};

type StateLike = {
  seats: Record<SeatId, Seat>;
  phase: Phase;
  ballots: Record<string, { eligible: Record<SeatId, { kind: SeatKind }> }>;
  documents: Record<string, DocumentState>;
  amendments: Record<string, Amendment>;
  activeCaucus?: CaucusState | null;
};

const humans = (s: StateLike) => Object.values(s.seats).filter((x) => x.kind === "human");
const presentHumans = (s: StateLike) => humans(s).filter(isPresent).map((x) => x.id);

function view(kind: ResponseKind, required: SeatId[], responded: SeatId[], holds: boolean, wait?: ResponseWait, standing: SeatId[] = []): ResponseView {
  const done = required.filter((x) => responded.includes(x) || standing.includes(x));
  return { kind, required, responded: done, pending: required.filter((x) => !done.includes(x)), holds, wait, standing: required.filter((x) => standing.includes(x) && !responded.includes(x)) };
}

/** voted(ballotId) → seats that have cast a vote (engine: keys of votes; public view: `voted`). */
export function responseView(s: StateLike, voted: (ballotId: string) => SeatId[]): ResponseView | null {
  const p = s.phase;
  switch (p.type) {
    case "ROLL_CALL":
      return view(
        "attendance",
        humans(s).map((x) => x.id),
        humans(s).filter(isPresent).map((x) => x.id),
        true,
        p.wait,
      );
    case "SPEECH_PREP":
      return s.seats[p.seat]?.kind === "human" ? view("start_speech", [p.seat], [], true, p.wait) : null;
    case "SPEECH_CONFIRM":
      return view("confirm_transcript", [p.seat], [], true, p.wait);
    case "FLOOR_OPEN":
      return view("motion", presentHumans(s), p.readySeats, true, p.wait, p.standingSeats ?? []);
    case "VP_FLOOR":
      return view("voting_motion", presentHumans(s), p.readySeats, true, p.wait);
    case "DIVISION_PROPOSALS":
      return view("division", presentHumans(s), p.readySeats, true, p.wait);
    case "MOTION_VOTE":
    case "VOTING_PROCEDURE": {
      if (p.stage !== "voting" || !p.ballotId) return null;
      const b = s.ballots[p.ballotId];
      if (!b) return null;
      const eligibleHumans = Object.entries(b.eligible)
        .filter(([, e]) => e.kind === "human")
        .map(([id]) => id);
      return view("vote", eligibleHumans, voted(p.ballotId), true, p.wait);
    }
    case "MOD_CAUCUS":
      return view("volunteer", presentHumans(s), [...p.volunteers, ...(p.passed ?? [])], true, p.wait, s.activeCaucus?.passAll ?? []);
    case "AMENDMENT_SPONSOR_RESPONSE": {
      const a = s.amendments[p.amendmentId];
      const doc = a ? s.documents[a.targetDocId] : undefined;
      const sponsors = (doc?.sponsors ?? []).filter((id) => s.seats[id]?.kind === "human" && isPresent(s.seats[id]));
      return view("sponsor", sponsors, Object.keys(p.responses), true, p.wait);
    }
    case "UNMOD_CAUCUS":
      // Informational: the caucus keeps the length adopted by motion; "ready" from every human ends it early.
      return view("caucus_ready", presentHumans(s).filter((id) => s.seats[id].connection === "online"), p.readySeats, false);
    default:
      return null;
  }
}

/** What the engine does to a pending human when the response window expires (product language: English). */
export const EXPIRY_ACTION: Record<ResponseKind, string> = {
  attendance: "you stay “not recorded as present” (no attendance is chosen for you); the meeting continues if the quorum is met",
  start_speech: "your turn ends without a speech and is recorded as no response; the meeting continues",
  confirm_transcript: "the automatic transcript is entered if one is ready, otherwise “no transcript”; the meeting continues",
  motion: "you are treated as having no motion; the meeting continues",
  voting_motion: "you are treated as having no motion; voting continues",
  division: "you are treated as having no proposal; voting continues",
  vote: "you are recorded as not voting (not as abstaining) and the vote is counted",
  volunteer: "you are treated as not volunteering this turn (you are asked again next turn)",
  sponsor: "friendly consent is not obtained (this is not an objection) and the amendment goes to a 2/3 vote",
  caucus_ready: "the caucus ends at its adopted time",
};

/** What a human must do to complete their response. */
export const RESPONSE_ACTION: Record<ResponseKind, string> = {
  attendance: "Declare your attendance",
  start_speech: "Start your speech",
  confirm_transcript: "Confirm what enters the record",
  motion: "Move a motion, or say you have none",
  voting_motion: "Move a voting-procedure motion, or say you have none",
  division: "Propose a division, or say you have none",
  vote: "Cast your vote",
  volunteer: "Volunteer to speak, or pass this turn",
  sponsor: "Accept or reject the amendment as a sponsor",
  caucus_ready: "Click “Ready to resume” when you are done",
};
