/**
 * View-model helpers for the meeting room: which stage the meeting is in, what is happening now, who is awaited,
 * and how a ballot passes. Pure functions over the public state; nothing here invents progress figures.
 */
import type { PublicBallot, PublicForumState } from "@/engine/publicView";
import { responseView, type ResponseView } from "@/engine/responses";
import type { OpenPolicies } from "@/engine/policies";
import type { Seat, SeatId } from "@/engine/types";

export type Stage = "roll_call" | "debate" | "voting" | "results";
export type DebateMode = "general" | "moderated" | "negotiation" | "resolutions";

export const STAGES: Array<{ id: Stage; label: string }> = [
  { id: "roll_call", label: "Roll call" },
  { id: "debate", label: "Debate & negotiation" },
  { id: "voting", label: "Final voting" },
  { id: "results", label: "Results" },
];

export const DEBATE_MODES: Array<{ id: DebateMode; label: string; hint: string }> = [
  { id: "general", label: "General debate", hint: "Speakers' list" },
  { id: "moderated", label: "Moderated caucus", hint: "Volunteers on a topic" },
  { id: "negotiation", label: "Negotiation & drafting", hint: "Unmoderated caucus" },
  { id: "resolutions", label: "Resolutions", hint: "Introduction & amendments" },
];

export function stageOf(s: PublicForumState): Stage {
  const t = s.phase.type;
  if (t === "LOBBY" || t === "BRIEFING" || t === "ROLL_CALL") return "roll_call";
  if (t === "CLOSED") return "results";
  if (t === "VP_FLOOR" || t === "DIVISION_PROPOSALS" || t === "VOTING_PROCEDURE") return "voting";
  return "debate";
}

/** The debate mode currently running, or null while motions are being taken / during a suspension. */
export function debateModeOf(s: PublicForumState): DebateMode | null {
  const p = s.phase;
  switch (p.type) {
    case "SPEECH_PREP":
    case "AI_SPEECH_PENDING":
    case "SPEECH":
    case "SPEECH_CONFIRM":
      return p.context.kind === "mod_caucus" ? "moderated" : p.context.kind === "dr_panel" ? "resolutions" : "general";
    case "MOD_CAUCUS":
      return "moderated";
    case "UNMOD_CAUCUS":
      return "negotiation";
    case "DR_INTRO":
    case "AMENDMENT_SPONSOR_RESPONSE":
      return "resolutions";
    default:
      return null;
  }
}

/** Short label of the sub-state inside the current stage. */
export function subStateOf(s: PublicForumState): string {
  const p = s.phase;
  switch (p.type) {
    case "BRIEFING":
      return "Opening briefing";
    case "ROLL_CALL":
      return "Declaring attendance";
    case "SPEECH_PREP":
      return "Speaker getting ready";
    case "AI_SPEECH_PENDING":
      return "AI preparing a statement";
    case "SPEECH":
      return p.context.kind === "yield" ? "Speech (yielded time)" : "Speech";
    case "SPEECH_CONFIRM":
      return "Confirming the record";
    case "FLOOR_OPEN":
      return "Floor open for motions";
    case "MOTION_VOTE":
      return p.stage === "reading" ? "Reading a motion" : "Voting on a motion";
    case "MOD_CAUCUS":
      return "Taking volunteers";
    case "UNMOD_CAUCUS":
      return "Free negotiation";
    case "SUSPENDED":
      return "Meeting suspended";
    case "DR_INTRO":
      return p.stage === "presentation" ? "Authors present" : "Questions & answers";
    case "AMENDMENT_SPONSOR_RESPONSE":
      return "Sponsors respond to an amendment";
    case "VP_FLOOR":
      return p.target.kind === "order" ? "Motions on the order of voting" : "Motion to divide?";
    case "DIVISION_PROPOSALS":
      return "Proposals to divide";
    case "VOTING_PROCEDURE":
      return p.stage === "reading" ? "Reading the item" : p.stage === "voting" ? "Voting" : "Next item";
    case "CLOSED":
      return "Forum closed";
    default:
      return "";
  }
}

export function publicResponseView(s: PublicForumState): ResponseView | null {
  return responseView(s, (id) => s.ballots[id]?.voted ?? []);
}

/** Who acts in the current step (for the situation card). */
export function actorOf(s: PublicForumState): Seat | null {
  const p = s.phase;
  if ("seat" in p && p.seat) return s.seats[p.seat] ?? null;
  if ((p.type === "MOTION_VOTE" || p.type === "VOTING_PROCEDURE") && p.ballotId) {
    const b = s.ballots[p.ballotId];
    if (b?.subject.type === "motion") return s.seats[s.motions[b.subject.motionId]?.mover] ?? null;
  }
  return null;
}

/** Response window (W1) if someone is awaited, else the phase timer. */
export type TimerView =
  | { mode: "countdown"; atMs: number; label: string }
  /** W1: the step's normal time is over and humans are still awaited — no number is shown (the internal deadline stays). */
  | { mode: "waiting"; pending: number };

/**
 * Main timer. Steps that await humans show their NORMAL time (e.g. 45 s voting) as a countdown; once it is over and
 * humans are still awaited, the timer turns into a waiting state without numbers. The internal response deadline
 * (requested + 300 s) is never shown as a countdown; only the 60 s / 15 s warnings refer to it.
 */
export function timerOf(s: PublicForumState, rv: ResponseView | null, now: number): TimerView | null {
  if (s.paused) return null;
  const p = s.phase;
  if (rv?.wait && rv.holds && rv.pending.length > 0 && now >= rv.wait.baseDeadlineMs) return { mode: "waiting", pending: rv.pending.length };
  const base = rv?.wait && rv.holds ? rv.wait.baseDeadlineMs : undefined;
  const d = base ?? (p as { deadlineMs?: number }).deadlineMs ?? (p.type === "SUSPENDED" ? p.resumeAtMs : undefined);
  if (d === undefined) return null;
  const label =
    p.type === "SPEECH"
      ? "Speaking time"
      : p.type === "UNMOD_CAUCUS"
        ? "Caucus time"
        : p.type === "SUSPENDED"
          ? "Resumes in"
          : p.type === "BRIEFING"
            ? "Roll call in"
            : (p.type === "MOTION_VOTE" || p.type === "VOTING_PROCEDURE") && p.stage === "reading"
              ? "Reading time"
              : (p.type === "MOTION_VOTE" || p.type === "VOTING_PROCEDURE") && p.stage === "voting"
                ? "Voting time"
                : "Step ends in";
  return { mode: "countdown", atMs: d, label };
}

/** Session end including time currently held for human responses (mirrors the engine). */
export function sessionEndOf(s: PublicForumState, now: number): number {
  const w = (s.phase as { wait?: { holding: boolean; baseDeadlineMs: number } }).wait;
  let extra = 0;
  if (w?.holding) {
    const left = s.settings.sessionDurationSec * 1000 - (s.usage.responseWaitCreditMs ?? 0);
    extra = Math.max(0, Math.min(now - w.baseDeadlineMs, left));
  }
  // S1: human speech time beyond the official speaking time (same formula as the engine)
  const p = s.phase;
  const over = p.type === "SPEECH" && p.speakerKind === "human" && p.officialSec ? Math.max(0, Math.min(now, p.deadlineMs) - (p.startedMs + p.officialSec * 1000)) : 0;
  return s.settings.sessionEndsAtMs + extra + over;
}

export const humansOf = (s: PublicForumState, ids: SeatId[]) => ids.map((id) => s.seats[id]).filter(Boolean);

// ── ballots ──────────────────────────────────────────────────────

export type PassRule =
  | { scale: "eligible"; needYes: number; eligible: number; text: string }
  | { scale: "decisive"; ratio: number; strict: boolean; text: string };

/** How this ballot passes — mirrors engine/voting.ts tally(). The denominator differs by rule/policy. */
export function passRule(b: PublicBallot, policies: OpenPolicies): PassRule {
  const pol = b.kind === "procedural" ? policies.proceduralNonResponse : policies.substantiveNonResponse;
  const e = Object.keys(b.eligible).length;
  if (pol === "require_majority_of_eligible") {
    if (b.threshold === "two_thirds") {
      const need = Math.max(1, Math.ceil((2 * e) / 3));
      return { scale: "eligible", needYes: need, eligible: e, text: `Needs at least ${need} Yes of ${e} eligible (two-thirds of the electorate fixed at opening; app policy D1)` };
    }
    const need = Math.floor(e / 2) + 1;
    return { scale: "eligible", needYes: need, eligible: e, text: `Needs at least ${need} Yes of ${e} eligible (more than half of the electorate fixed at opening; app policy D1)` };
  }
  if (b.threshold === "two_thirds") return { scale: "decisive", ratio: 2 / 3, strict: false, text: "Needs Yes ≥ 2 × No — two-thirds of Yes + No (rule 35); abstentions and non-votes are not counted" };
  return { scale: "decisive", ratio: 0.5, strict: true, text: "Needs more Yes than No (rule 35); abstentions and non-votes are not counted" };
}

export function outcomeLabel(b: PublicBallot): { text: string; tone: "pass" | "fail" | "neutral" } | null {
  if (b.status === "not_held") return { text: "NOT HELD — no voting quorum", tone: "neutral" };
  if (b.status !== "closed" || !b.result) return null;
  if (b.subject.type === "division_part") return b.result.passed ? { text: "INCLUDED", tone: "pass" } : { text: "EXCLUDED", tone: "fail" };
  return b.result.passed ? { text: "ADOPTED", tone: "pass" } : { text: "NOT ADOPTED", tone: "fail" };
}
