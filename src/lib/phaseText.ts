import type { PublicForumState } from "@/engine/publicView";
import type { MotionParams, MotionType } from "@/engine/types";

export const MOTION_LABEL: Record<MotionType, string> = {
  adjourn: "Adjourn the meeting",
  suspend: "Suspend the meeting",
  extend_caucus: "Extend the caucus",
  unmod_caucus: "Unmoderated caucus",
  mod_caucus: "Moderated caucus",
  set_speaking_time: "Set speaking time",
  introduce_resolution: "Introduce draft resolutions",
  introduce_amendment: "Introduce an amendment",
  enter_voting: "Move into voting procedure",
  reorder_resolutions: "Reorder resolutions",
  divide_question: "Divide the question",
};

export function describeMotion(p: MotionParams): string {
  switch (p.type) {
    case "mod_caucus":
      return `${MOTION_LABEL[p.type]} — "${p.topic}", ${p.speakingSec}s speeches, ${Math.round(p.totalSec / 60)} min total`;
    case "unmod_caucus":
      return `${MOTION_LABEL[p.type]} — ${Math.round(p.totalSec / 60)} min`;
    case "extend_caucus":
    case "suspend":
      return `${MOTION_LABEL[p.type]} — ${Math.round(p.durationSec / 60 * 10) / 10} min`;
    case "set_speaking_time":
      return `${MOTION_LABEL[p.type]} — ${p.speakingSec}s`;
    default:
      return MOTION_LABEL[p.type];
  }
}

const name = (s: PublicForumState, id?: string) => (id ? (s.seats[id]?.countryName ?? id) : "");

/** What is happening now, and what comes next — always shown at the top of the room. */
export function describePhase(s: PublicForumState): { title: string; detail: string; next: string } {
  const p = s.phase;
  switch (p.type) {
    case "LOBBY":
      return { title: "Waiting room", detail: "Delegations are taking their seats.", next: "The room owner starts the forum; seats are then fixed." };
    case "ROLL_CALL":
      return { title: "Roll call", detail: "Declare Present or Present and voting (rule 31). AI delegations answer automatically.", next: "Debate opens once at least a quarter of the delegations are present (rule 32)." };
    case "SPEECH_PREP":
      return { title: `Next speaker: ${name(s, p.seat)}`, detail: "Preparation time before the floor opens for this speaker.", next: "Speech" };
    case "AI_SPEECH_PENDING":
      return { title: `${name(s, p.seat)} (AI) is preparing`, detail: "The AI delegation's statement is being prepared. Waiting time is not counted as speaking time.", next: "Speech" };
    case "SPEECH":
      return {
        title: `${name(s, p.seat)} has the floor`,
        detail: p.context.kind === "mod_caucus" ? "Moderated caucus speech" : "Formal debate (speakers' list)",
        next: p.speakerKind === "human" ? "Speaker confirms the transcript" : "Floor opens for points and motions",
      };
    case "SPEECH_CONFIRM":
      return { title: `${name(s, p.seat)} is confirming the record`, detail: "The speech enters the record (and AI context) only after confirmation, typed text, or timeout.", next: "Floor opens for points and motions" };
    case "FLOOR_OPEN":
      return { title: "Floor open for motions", detail: "Submit motions now. The window stays open for its full time unless every online delegate is ready.", next: "Valid motions are ordered by precedence (rule 36) and voted one by one; otherwise the next speaker." };
    case "MOTION_VOTE":
      return {
        title: p.stage === "reading" ? "Read the motion" : "Vote on the motion",
        detail: p.stage === "reading" ? "Reading time — voting opens when it ends." : "Procedural vote: Yes or No (rule 30).",
        next: p.queue.length ? `${p.queue.length} more motion(s) after this one` : "Result, then the adopted mode or the speakers' list",
      };
    case "MOD_CAUCUS":
      return { title: "Moderated caucus", detail: `Topic: ${s.activeCaucus?.topic ?? ""}. Volunteer to speak. Each speech counts its full speaking time (rule 10).`, next: "Next volunteer, or the caucus ends if nobody volunteers" };
    case "UNMOD_CAUCUS":
      return { title: "Unmoderated caucus", detail: "Formal debate is suspended: talk freely and work on documents.", next: "Floor opens (extension possible, rule 12)" };
    case "SUSPENDED":
      return { title: "Meeting suspended", detail: "Formal suspension adopted by motion (rule 14).", next: "Debate resumes automatically" };
    case "DR_INTRO":
      return { title: "Draft resolution introduction", detail: p.stage === "presentation" ? "Authors' presentation" : "Questions and answers", next: "Floor opens" };
    case "AMENDMENT_SPONSOR_RESPONSE":
      return { title: "Sponsors respond to the amendment", detail: "If every sponsor agrees it is friendly; otherwise it goes to a 2/3 vote (rule 29).", next: "Floor opens" };
    case "VOTING_PROCEDURE":
      return { title: "Voting procedure", detail: "Substantive votes on amendments and resolutions; text is locked during each vote.", next: "Next item, then the forum closes" };
    case "CLOSED":
      return { title: "Forum closed", detail: closedReason(p.reason), next: "" };
  }
}

export function closedReason(r: string) {
  return (
    {
      adjourned: "Adjourned by motion (rule 14).",
      session_time_over: "Session time ended.",
      voting_completed: "Voting procedure completed.",
    } as Record<string, string>
  )[r] ?? r;
}

export function phaseDeadlineOf(s: PublicForumState): number | null {
  if (s.paused) return null;
  const p = s.phase as { deadlineMs?: number; resumeAtMs?: number };
  return p.deadlineMs ?? p.resumeAtMs ?? null;
}

export function fmtClock(ms: number) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
