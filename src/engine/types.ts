import type { OpenPolicies } from "@/engine/policies";
import type { CommitteeId } from "@/engine/committees";

export type SeatId = string; // lower-case ISO 3166-1 alpha-2 code
export type SeatKind = "human" | "ai";
export type Attendance = "not_recorded" | "present" | "present_and_voting";

export type Seat = {
  id: SeatId;
  countryName: string;
  kind: SeatKind;
  uid?: string;
  attendance: Attendance;
  connection: "online" | "offline";
};

export type Settings = {
  speakingTimeSec: number;
  timers: {
    rollCallSec: number;
    motionWindowSec: number;
    readingSec: number;
    votingSec: number;
    humanPrepSec: number;
    transcriptConfirmSec: number;
    aiSpeechReadyTimeoutSec: number;
    aiPlaybackLeadMs: number;
    volunteerWindowSec: number;
    sponsorResponseSec: number;
    drPresentationSec: number;
    drQaSec: number;
    /** App policy H1: how long an idle hold (no human online) lasts before the forum closes. Optional for older forums. */
    idleHoldMaxSec?: number;
    /**
     * App policy W1 ("wait for required human responses"): how long a required human response is awaited
     * after it is requested. 0/undefined = legacy behaviour (short phase timers only). New forums: 300.
     */
    responseWaitSec?: number;
    /** Start briefing shown to everyone before roll call (0/undefined = none). New forums: 12. */
    briefingSec?: number;
  };
  limits: {
    extensionSec: number;
    maxExtensionPerWindowSec: number;
    maxExtensionsPerSeat: number;
    nonResponseExtensionSec: number;
    pauseMaxSec: number;
    pauseTotalMaxSec: number;
    maxMotionsPerSeatPerWindow: number;
  };
  dilatory: {
    modSpeakingMinSec: number;
    modSpeakingMaxSec: number;
    modTotalMinSec: number;
    modTotalMaxSec: number;
    unmodMinSec: number;
    unmodMaxSec: number;
    speakingTimeMinSec: number;
    speakingTimeMaxSec: number;
    suspendMinSec: number;
    suspendMaxSec: number;
    /** Adjournment is dilatory while more than this fraction of session time remains. */
    adjournMaxRemainingRatio: number;
  };
  documents: {
    minSponsors: number;
    minSignatoryRatio: number;
    minPreambular: number;
    minOperative: number;
    maxResolutions: number;
    minAmendmentSignatories: number;
  };
  /** Planned meeting length; the clock starts when the room owner starts the forum. */
  sessionDurationSec: number;
  sessionStartMs: number;
  sessionEndsAtMs: number;
  policies: OpenPolicies;
};

// ── Motions ────────────────────────────────────────────────────────
export type MotionType =
  | "adjourn"
  | "suspend"
  | "extend_caucus"
  | "unmod_caucus"
  | "mod_caucus"
  | "set_speaking_time"
  | "introduce_resolution"
  | "introduce_amendment"
  | "enter_voting"
  | "reorder_resolutions"
  | "divide_question";

export type MotionParams =
  | { type: "adjourn" }
  | { type: "suspend"; durationSec: number }
  | { type: "extend_caucus"; durationSec: number }
  | { type: "unmod_caucus"; totalSec: number }
  | { type: "mod_caucus"; topic: string; speakingSec: number; totalSec: number }
  | { type: "set_speaking_time"; speakingSec: number }
  | { type: "introduce_resolution" }
  | { type: "introduce_amendment"; amendmentId: string }
  | { type: "enter_voting" }
  | { type: "reorder_resolutions"; order: string[] }
  | { type: "divide_question"; docId: string };

export type Motion = {
  id: string;
  params: MotionParams;
  mover: SeatId;
  submittedAtMs: number;
  windowId: string;
  /** Natural idempotency key: same seat + same content in the same window is one motion. */
  contentKey: string;
  status: "pending" | "voting" | "adopted" | "rejected" | "lapsed" | "obsolete" | "not_held";
  disposition?: { reason: string; source: string };
  /** Set when the motion was carried over from an earlier floor window (D3). */
  carriedFromWindowId?: string;
  ballotId?: string;
};

// ── Ballots ───────────────────────────────────────────────────────
export type VoteChoice = "yes" | "no" | "abstain";
export type BallotKind = "procedural" | "substantive";
export type Threshold = "simple_majority" | "two_thirds";

export type BallotSubject =
  | { type: "motion"; motionId: string }
  | { type: "division_proposal"; docId: string; proposalId: string; textHash: string }
  | { type: "division_part"; docId: string; part: number; textHash: string }
  | { type: "amendment"; amendmentId: string; textHash: string }
  | { type: "resolution"; docId: string; version: number; textHash: string };

export type TallyResult = {
  yes: number;
  no: number;
  abstain: number;
  eligibleCount: number;
  notVoted: SeatId[];
  notVotedOffline: SeatId[];
  passed: boolean;
  formula: string;
};

export type Ballot = {
  id: string;
  kind: BallotKind;
  threshold: Threshold;
  subject: BallotSubject;
  openedAtMs: number;
  /** Fixed at open; never changes afterwards (disconnects do not alter it). */
  eligible: Record<SeatId, { attendance: Attendance; kind: SeatKind }>;
  membersTotal: number;
  presentAtOpen: number;
  quorumRequired: number;
  quorumMet: boolean;
  votes: Record<SeatId, VoteChoice>;
  status: "reading" | "open" | "closed" | "not_held";
  extendedForNonResponse: boolean;
  extensionUsedSec: number;
  connectionAtClose?: Record<SeatId, "online" | "offline">;
  result?: TallyResult;
};

// ── Documents ─────────────────────────────────────────────────────
export type DocKind = "working_paper" | "draft_resolution";
export type DocumentState = {
  id: string;
  kind: DocKind;
  title: string;
  sponsors: SeatId[];
  signatories: SeatId[];
  preambular: string[];
  operative: string[];
  version: number;
  textHash: string;
  /** not_voted = voting quorum missing (D7); never displayed as rejected. */
  status: "draft" | "approved" | "introduced" | "adopted" | "failed" | "not_voted";
  submittedBy: SeatId;
  submittedAtMs: number;
};

export type AmendmentOp =
  | { kind: "replace"; clauseIndex: number; text: string }
  | { kind: "insert"; clauseIndex: number; text: string }
  | { kind: "delete"; clauseIndex: number };

export type Amendment = {
  id: string;
  targetDocId: string;
  targetVersion: number;
  op: AmendmentOp;
  proposer: SeatId;
  signatories: SeatId[];
  textHash: string;
  status: "draft" | "awaiting_sponsors" | "friendly_adopted" | "unfriendly_pending" | "adopted" | "failed" | "not_held";
  /** D5: distinguishes an explicit objection from silence. */
  friendlyOutcome?: "all_agreed" | "objected" | "consent_not_obtained";
};

/**
 * Rule 33 (division of the question). A proposal lists groups of operative clause indices (0-based);
 * clauses not listed form one more part ("remaining clauses"). Every part is voted for inclusion.
 */
export type DivisionProposal = {
  id: string;
  docId: string;
  proposer: SeatId;
  /** Parts in display order; each part lists sorted operative clause indices (objects: Firestore has no nested arrays). */
  parts: Array<{ clauses: number[] }>;
  submittedAtMs: number;
  status: "pending" | "voting" | "adopted" | "failed" | "discarded" | "not_held";
};

export type DivisionState = {
  docId: string;
  /** Text version the division applies to (locked: no amendments run after division starts). */
  baseVersion: number;
  baseOperative: string[];
  proposals: string[];
  adoptedProposalId?: string;
  /** Inclusion result per part of the adopted proposal (null = vote not held). */
  partResults?: Array<boolean | null>;
  outcome?: "intact" | "recombined" | "rejected_as_whole";
};

// ── Record (context for AI) ───────────────────────────────────────
export type RecordSource =
  | "human_voice_confirmed"
  | "human_voice_auto"
  | "human_text"
  | "human_no_transcript"
  | "human_forfeit"
  | "ai_speech"
  | "ai_unavailable"
  | "chair";

export type RecordEntry = {
  seq: number;
  atMs: number;
  seat?: SeatId;
  source: RecordSource;
  text: string;
  phaseId: string;
  /** Contributes to AI context (increments contextSeq). */
  substantive: boolean;
  /** App policy W1 bookkeeping, for the UI: an automatic step after a response window expired, or a seat not awaited. */
  kind?: "response_timeout" | "not_awaited";
};

// ── Phases ────────────────────────────────────────────────────────
/**
 * App policy W1. Attached to a phase that needs responses from specific humans (see engine/responses.ts).
 * baseDeadlineMs = the phase's normal timer (the AI work window). The phase never ends before every required
 * human has responded or responseDeadlineMs has passed (offline humans are not awaited past the base timer).
 * Time held past baseDeadlineMs is added back to the session end (not charged to the meeting's time budget).
 */
export type ResponseWait = {
  requestedAtMs: number;
  baseDeadlineMs: number;
  responseDeadlineMs: number;
  /** True once the base timer passed and the phase is held for humans. */
  holding: boolean;
  /** Legacy field from the first W1 version (offline seats were not awaited); no longer written. */
  notedOffline?: SeatId[];
};

export type SpeechContext =
  | { kind: "speakers_list" }
  | { kind: "mod_caucus" }
  | { kind: "dr_panel"; docId: string }
  /** Rule 18: remaining time yielded by another delegate; the receiver may not yield again. */
  | { kind: "yield"; from: SeatId; sec: number };

export type Phase =
  | { type: "LOBBY" }
  | { type: "BRIEFING"; startedMs: number; deadlineMs: number }
  | { type: "ROLL_CALL"; deadlineMs: number; wait?: ResponseWait }
  | { type: "SPEECH_PREP"; seat: SeatId; deadlineMs: number; context: SpeechContext; wait?: ResponseWait }
  | { type: "AI_SPEECH_PENDING"; seat: SeatId; deadlineMs: number; requiredContextSeq: number; context: SpeechContext }
  | {
      type: "SPEECH";
      seat: SeatId;
      speakerKind: SeatKind;
      startedMs: number;
      deadlineMs: number;
      context: SpeechContext;
      ai?: { text: string; audioId?: string; playStartMs: number; durationMs?: number; contextSeq: number };
    }
  | {
      type: "SPEECH_CONFIRM";
      seat: SeatId;
      deadlineMs: number;
      context: SpeechContext;
      transcript: { status: "pending" | "ready" | "failed"; text?: string };
      waitExtended: boolean;
      /** Rule 18: remaining time handed to another delegate after this speech is recorded. */
      yieldTo?: { seat: SeatId; sec: number };
      wait?: ResponseWait;
    }
  | {
      type: "FLOOR_OPEN";
      windowId: string;
      deadlineMs: number;
      origin: "after_speech" | "after_caucus" | "empty_list" | "after_motions" | "after_resume";
      readySeats: SeatId[];
      aiDoneSeats: SeatId[];
      extensionUsedSec: number;
      wait?: ResponseWait;
      /**
       * W1: present humans whose explicit "no motion" from an earlier window still stands because nothing meaningful
       * changed since (no new statement, speaker, document or amendment state). They are not asked again; the window
       * still stays open for its normal timer so they can move a motion if they want.
       */
      standingSeats?: SeatId[];
    }
  | {
      type: "MOTION_VOTE";
      windowId: string;
      queue: string[];
      currentMotionId: string;
      ballotId: string;
      stage: "reading" | "voting";
      deadlineMs: number;
      wait?: ResponseWait;
    }
  | { type: "MOD_CAUCUS"; deadlineMs: number; volunteers: SeatId[]; passed?: SeatId[]; wait?: ResponseWait }
  | { type: "UNMOD_CAUCUS"; deadlineMs: number; readySeats: SeatId[] }
  | { type: "SUSPENDED"; resumeAtMs: number }
  | { type: "DR_INTRO"; queue: string[]; docId: string; stage: "presentation" | "qa"; deadlineMs: number }
  | {
      type: "AMENDMENT_SPONSOR_RESPONSE";
      amendmentId: string;
      deadlineMs: number;
      responses: Record<SeatId, "agree" | "disagree">;
      waitExtended: boolean;
      wait?: ResponseWait;
    }
  /** Motions in voting procedure (rules 33, 34). target "order": reordering; otherwise division of that resolution. */
  | {
      type: "VP_FLOOR";
      windowId: string;
      target: { kind: "order" } | { kind: "division"; docId: string };
      deadlineMs: number;
      readySeats: SeatId[];
      aiDoneSeats: SeatId[];
      queue: VotingItem[];
      wait?: ResponseWait;
    }
  /** Rule 33: after the motion to divide passes, delegations propose how to divide. */
  | { type: "DIVISION_PROPOSALS"; docId: string; deadlineMs: number; readySeats: SeatId[]; aiDoneSeats: SeatId[]; queue: VotingItem[]; wait?: ResponseWait }
  | {
      type: "VOTING_PROCEDURE";
      queue: VotingItem[];
      ballotId: string | null;
      stage: "reading" | "voting" | "between";
      deadlineMs: number;
      wait?: ResponseWait;
    }
  | { type: "CLOSED"; reason: string };

export type VotingItem =
  | { kind: "amendment"; id: string }
  | { kind: "resolution"; id: string }
  | { kind: "vp_floor"; target: "order" }
  | { kind: "vp_floor"; target: "division"; docId: string }
  | { kind: "motion"; id: string }
  | { kind: "division_proposal"; id: string }
  | { kind: "division_part"; docId: string; part: number }
  | { kind: "recombine"; docId: string };

export type CaucusState = {
  kind: "mod" | "unmod";
  motionId: string;
  topic?: string;
  speakingSec?: number;
  totalSec: number;
  usedSec: number;
  spokenSeats: SeatId[];
  isExtension: boolean;
  /** W1: humans who chose "pass for the rest of this caucus" (they may still volunteer in any turn). */
  passAll?: SeatId[];
};

export type ForumEngineState = {
  forumId: string;
  rulesetId: string;
  committeeId: CommitteeId;
  ownerUid: string;
  settings: Settings;
  seats: Record<SeatId, Seat>;
  joinLocked: boolean;

  phase: Phase;
  /** Changes on every phase transition. Commands tied to a phase carry it. */
  phaseId: string;
  phaseSeq: number;
  /** Increments for every applied event (any participant). Used for ordering, NOT for staleness checks. */
  eventSeq: number;
  /** Increments only when the substantive context changes (confirmed speech, adopted outcome, text change). */
  contextSeq: number;
  recordSeq: number;

  speakingTimeSec: number;
  speakersList: SeatId[];
  motions: Record<string, Motion>;
  carriedMotionIds: string[];
  activeCaucus: CaucusState | null;
  lastEndedCaucus: (CaucusState & { endedPhaseId: string }) | null;
  ballots: Record<string, Ballot>;
  documents: Record<string, DocumentState>;
  amendments: Record<string, Amendment>;
  introducedResolutionIds: string[];
  debateClosed: boolean;
  /** Voting procedure (rules 33–34). Optional for states created before these existed. */
  divisions?: Record<string, DivisionState>;
  divisionProposals?: Record<string, DivisionProposal>;
  votingOrder?: string[];
  reorderAdopted?: boolean;
  /** W1: a human's explicit "no motion" and the floor context it was given in (see FLOOR_OPEN.standingSeats). */
  standingNoMotion?: Record<SeatId, string>;

  /**
   * reason "owner": app pause by the room owner. reason "no_humans": idle hold (app policy H1) entered when a
   * deadline passes while no human delegate is online; resumes when one reconnects, closes at autoResumeAtMs.
   */
  paused: { pausedAtMs: number; remainingMs: number; autoResumeAtMs: number; phaseDeadlineKey: string; reason?: "owner" | "no_humans" } | null;
  usage: { extensionsBySeat: Record<SeatId, number>; pauseUsedSec: number; /** W1: time held for humans, added back to the session end (ms). */ responseWaitCreditMs?: number };
  idCounter: number;
};

// ── Commands ──────────────────────────────────────────────────────
export type Actor = { kind: "human"; uid: string } | { kind: "ai"; seat: SeatId } | { kind: "system" };

export type Command =
  | { type: "claim_seat"; seat: SeatId }
  | { type: "release_seat"; seat: SeatId }
  | { type: "start" }
  | { type: "declare_attendance"; seat: SeatId; value: "present" | "present_and_voting" }
  | { type: "add_to_speakers_list"; seat: SeatId }
  | { type: "remove_from_speakers_list"; seat: SeatId }
  | { type: "start_speech"; seat: SeatId }
  | { type: "end_speech"; seat: SeatId; yieldTo?: SeatId }
  | { type: "transcript_result"; seat: SeatId; ok: boolean; text?: string }
  | { type: "confirm_transcript"; seat: SeatId; text: string }
  | { type: "submit_text_speech"; seat: SeatId; text: string }
  | { type: "skip_transcript"; seat: SeatId }
  | { type: "ai_speech_ready"; seat: SeatId; text: string; contextSeq: number; audioId?: string; durationMs?: number }
  | { type: "submit_motion"; seat: SeatId; params: MotionParams }
  | { type: "floor_pass"; seat: SeatId }
  | { type: "request_extension"; seat: SeatId }
  | { type: "cast_vote"; seat: SeatId; ballotId: string; choice: VoteChoice }
  | { type: "volunteer"; seat: SeatId }
  /** turn: this volunteer round only · caucus: every remaining round of this caucus · resume: be asked every round again */
  | { type: "volunteer_pass"; seat: SeatId; scope?: "turn" | "caucus" | "resume" }
  | { type: "caucus_ready"; seat: SeatId }
  | {
      type: "submit_document";
      seat: SeatId;
      kind: DocKind;
      title: string;
      preambular: string[];
      operative: string[];
    }
  | { type: "update_document"; seat: SeatId; docId: string; preambular: string[]; operative: string[] }
  | { type: "sign_document"; seat: SeatId; docId: string; role: "sponsor" | "signatory" }
  | { type: "submit_amendment"; seat: SeatId; targetDocId: string; op: AmendmentOp }
  | { type: "sign_amendment"; seat: SeatId; amendmentId: string }
  | { type: "sponsor_response"; seat: SeatId; amendmentId: string; agree: boolean }
  | { type: "submit_division_proposal"; seat: SeatId; docId: string; parts: number[][] }
  | { type: "raise_point"; seat: SeatId; kind: "personal_privilege"; text: string }
  | { type: "app_pause" }
  | { type: "app_resume" }
  | { type: "connection"; seat: SeatId; online: boolean }
  | { type: "tick" };

/**
 * Staleness guards. Each field is optional and only checked when present, so an action is
 * invalidated ONLY by changes that matter to it — not by unrelated activity of other seats.
 */
export type Expectation = {
  phaseId?: string;
  ballotId?: string;
  /** Substantive context the actor reasoned over (AI speeches / AI votes). */
  contextSeq?: number;
  /** Text version of the subject being voted or amended. */
  textHash?: string;
};

export type CommandEnvelope = { actor: Actor; command: Command; expect?: Expectation };

export type Effect =
  | { type: "schedule"; atMs: number; phaseId: string }
  | { type: "record"; entry: RecordEntry }
  | { type: "ai_speech_needed"; seat: SeatId; contextSeq: number; maxWords: number; context: SpeechContext }
  | { type: "ai_floor_decision_needed"; windowId: string; contextSeq: number }
  | { type: "ai_vote_needed"; ballotId: string; seats: SeatId[] }
  | { type: "ai_attendance_needed"; seats: SeatId[] }
  | { type: "ai_sponsor_response_needed"; amendmentId: string; seats: SeatId[] }
  | { type: "ai_volunteer_needed"; phaseId: string; seats: SeatId[] }
  /** trigger: id of a document/amendment submitted during the caucus (AI reconsiders), absent at caucus start. */
  | { type: "ai_caucus_work_needed"; phaseId: string; seats: SeatId[]; trigger?: string }
  | { type: "ai_voting_motion_needed"; phaseId: string; seats: SeatId[] }
  | { type: "transcription_expected"; seat: SeatId; phaseId: string }
  | { type: "announce"; text: string }
  | { type: "forum_closed"; reason: string };

export type EngineEvent = { seq: number; atMs: number; actor: Actor; command: Command["type"]; summary: string };

export type ApplyResult =
  | { ok: true; state: ForumEngineState; effects: Effect[]; events: EngineEvent[]; duplicate?: boolean }
  | { ok: false; code: string; message: string; stale?: boolean };
