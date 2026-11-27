/**
 * BridgeMUN automatic chair — a pure, deterministic state machine.
 *
 *   apply(state, { actor, command, expect }, nowMs) → { state, effects, events } | rejection
 *
 * - No I/O, no clocks: the caller passes server time. The same input always yields the same output.
 * - Legality, precedence, quorum, tallies and transitions are decided here; LLMs never decide outcomes.
 * - The room owner has only room powers (start, app pause/resume). Chair powers belong to this code.
 */
import { assertPoliciesComplete } from "@/engine/policies";
import { DEFAULT_SPEAKING_TIME_SEC, RULESET_ID } from "@/engine/ruleset/hmun-ga-2026";
import type { CommitteeId } from "@/engine/committees";
import {
  compareMotions,
  dispositionAfterAdoption,
  motionContentKey,
  motionThreshold,
  validateMotion,
} from "@/engine/motions";
import {
  allEligibleVoted,
  checkVote,
  debateQuorumRequired,
  isPresent,
  openBallot,
  pendingVoters,
  tally,
} from "@/engine/voting";
import { responseView } from "@/engine/responses";
import {
  MIN_SEATS,
  applyAmendmentOp,
  docTextHash,
  evaluateApproval,
  stableHash,
  validateAmendmentOp,
} from "@/engine/documents";
import type {
  Actor,
  ApplyResult,
  Ballot,
  CaucusState,
  Command,
  CommandEnvelope,
  Effect,
  EngineEvent,
  ForumEngineState,
  Motion,
  Phase,
  RecordEntry,
  Seat,
  SeatId,
  Settings,
  SpeechContext,
  DivisionProposal,
  ResponseWait,
  VotingItem,
} from "@/engine/types";

// ── construction ─────────────────────────────────────────────────

export function defaultSettingsBase(): Omit<Settings, "sessionDurationSec" | "sessionStartMs" | "sessionEndsAtMs" | "policies"> {
  return {
    speakingTimeSec: DEFAULT_SPEAKING_TIME_SEC, // rule 17 (official)
    timers: {
      // App UX defaults (product owner request) — NOT MUN rules.
      rollCallSec: 60,
      motionWindowSec: 45,
      readingSec: 10,
      votingSec: 45,
      humanPrepSec: 10,
      transcriptConfirmSec: 20,
      aiSpeechReadyTimeoutSec: 25,
      aiPlaybackLeadMs: 1500,
      volunteerWindowSec: 15,
      sponsorResponseSec: 30,
      drPresentationSec: 90,
      drQaSec: 120,
      idleHoldMaxSec: 600,
    },
    limits: {
      extensionSec: 30,
      maxExtensionPerWindowSec: 60,
      maxExtensionsPerSeat: 5,
      nonResponseExtensionSec: 15,
      pauseMaxSec: 300,
      pauseTotalMaxSec: 900,
      maxMotionsPerSeatPerWindow: 2,
    },
    dilatory: {
      modSpeakingMinSec: 15,
      modSpeakingMaxSec: 120,
      modTotalMinSec: 60,
      modTotalMaxSec: 1200,
      unmodMinSec: 60,
      unmodMaxSec: 600,
      speakingTimeMinSec: 15,
      speakingTimeMaxSec: 180,
      suspendMinSec: 60,
      suspendMaxSec: 600,
      adjournMaxRemainingRatio: 0.2,
    },
    documents: {
      minSponsors: 2,
      minSignatoryRatio: 0.2,
      minPreambular: 1,
      minOperative: 2,
      maxResolutions: 3,
      minAmendmentSignatories: 2,
    },
  };
}

export function createForumState(args: {
  forumId: string;
  committeeId: CommitteeId;
  ownerUid: string;
  seats: Seat[];
  settings: Settings;
}): ForumEngineState {
  assertPoliciesComplete(args.settings.policies);
  if (args.seats.length < MIN_SEATS) throw new Error(`A forum needs at least ${MIN_SEATS} delegations (app policy)`);
  const seats: Record<SeatId, Seat> = {};
  for (const s of args.seats) {
    if (seats[s.id]) throw new Error(`Duplicate seat ${s.id}`);
    seats[s.id] = { ...s, attendance: "not_recorded" };
  }
  return {
    forumId: args.forumId,
    rulesetId: RULESET_ID,
    committeeId: args.committeeId,
    ownerUid: args.ownerUid,
    settings: args.settings,
    seats,
    joinLocked: false,
    phase: { type: "LOBBY" },
    phaseId: "p0",
    phaseSeq: 0,
    eventSeq: 0,
    contextSeq: 0,
    recordSeq: 0,
    speakingTimeSec: args.settings.speakingTimeSec,
    speakersList: [],
    motions: {},
    carriedMotionIds: [],
    activeCaucus: null,
    lastEndedCaucus: null,
    ballots: {},
    documents: {},
    amendments: {},
    introducedResolutionIds: [],
    debateClosed: false,
    paused: null,
    usage: { extensionsBySeat: {}, pauseUsedSec: 0 },
    idCounter: 0,
  };
}

// ── context ──────────────────────────────────────────────────────

type Ctx = {
  s: ForumEngineState;
  now: number;
  actor: Actor;
  effects: Effect[];
  notes: string[];
  /** Seat whose speaking slot just ended (moderated caucus accounting). */
  actorSeatLast?: SeatId;
};

class Reject extends Error {
  constructor(
    public code: string,
    message: string,
    public stale = false,
  ) {
    super(message);
  }
}
const reject = (code: string, message: string, stale = false): never => {
  throw new Reject(code, message, stale);
};
class Duplicate extends Error {}

function newId(ctx: Ctx, prefix: string) {
  ctx.s.idCounter += 1;
  return `${prefix}${ctx.s.idCounter}`;
}

export function phaseDeadline(p: Phase): number | null {
  if ("deadlineMs" in p) return p.deadlineMs;
  if (p.type === "SUSPENDED") return p.resumeAtMs;
  return null;
}

function setPhaseDeadline(p: Phase, ms: number) {
  if ("deadlineMs" in p) (p as { deadlineMs: number }).deadlineMs = ms;
  else if (p.type === "SUSPENDED") p.resumeAtMs = ms;
}

function schedule(ctx: Ctx, atMs: number) {
  ctx.effects.push({ type: "schedule", atMs, phaseId: ctx.s.phaseId });
}

function transition(ctx: Ctx, phase: Phase) {
  commitHoldCredit(ctx);
  ctx.s.phaseSeq += 1;
  ctx.s.phaseId = `p${ctx.s.phaseSeq}`;
  ctx.s.phase = phase;
  attachWait(ctx);
  const d = phaseDeadline(phase);
  if (d !== null) schedule(ctx, d);
  ctx.notes.push(`→ ${phase.type}`);
}

// ── app policy W1: wait for required human responses ─────────────

/** Seconds a required human response is awaited (0 = legacy forums without W1). */
export function responseWaitSec(s: ForumEngineState): number {
  return s.settings.timers.responseWaitSec ?? 0;
}
const W = (s: ForumEngineState) => responseWaitSec(s) > 0;
const engineVoted = (s: ForumEngineState) => (id: string) => Object.keys(s.ballots[id]?.votes ?? {});
const WAIT_PHASES = new Set<Phase["type"]>([
  "ROLL_CALL",
  "SPEECH_PREP",
  "SPEECH_CONFIRM",
  "FLOOR_OPEN",
  "VP_FLOOR",
  "DIVISION_PROPOSALS",
  "MOD_CAUCUS",
  "AMENDMENT_SPONSOR_RESPONSE",
]);

function newWait(ctx: Ctx, baseDeadlineMs: number): ResponseWait {
  return {
    requestedAtMs: ctx.now,
    baseDeadlineMs,
    responseDeadlineMs: Math.max(baseDeadlineMs, ctx.now + responseWaitSec(ctx.s) * 1000),
    holding: false,
  };
}

/** Starts the response window when a phase that needs human responses begins (votes: when voting opens). */
function attachWait(ctx: Ctx) {
  if (!W(ctx.s)) return;
  const p = ctx.s.phase;
  if (!WAIT_PHASES.has(p.type)) return;
  const d = phaseDeadline(p);
  if (d === null) return;
  (p as { wait?: ResponseWait }).wait = newWait(ctx, d);
}

/** Time the current phase has been held past its normal timer — not charged to the session budget. */
function holdCreditMs(s: ForumEngineState, now: number): number {
  const w = (s.phase as { wait?: ResponseWait }).wait;
  if (!w?.holding) return 0;
  const raw = Math.max(0, now - w.baseDeadlineMs);
  const left = s.settings.sessionDurationSec * 1000 - (s.usage.responseWaitCreditMs ?? 0); // cap: at most one extra session length
  return Math.max(0, Math.min(raw, left));
}

/**
 * S1: time a human speech has run beyond its official speaking time. Only time actually used is credited (never the
 * whole 300 s up front); separate from the W1 credit and its cap; pauses are excluded (startedMs is shifted on resume).
 */
function speechOvertimeMs(s: ForumEngineState, now: number): number {
  const p = s.phase;
  if (p.type !== "SPEECH" || p.speakerKind !== "human" || !p.officialSec) return 0;
  return Math.max(0, Math.min(now, p.deadlineMs) - (p.startedMs + p.officialSec * 1000));
}

function commitHoldCredit(ctx: Ctx) {
  const c = holdCreditMs(ctx.s, ctx.now);
  if (c > 0) {
    ctx.s.settings.sessionEndsAtMs += c;
    ctx.s.usage.responseWaitCreditMs = (ctx.s.usage.responseWaitCreditMs ?? 0) + c;
  }
  const o = speechOvertimeMs(ctx.s, ctx.now);
  if (o > 0) {
    ctx.s.settings.sessionEndsAtMs += o;
    ctx.s.usage.speechOvertimeCreditMs = (ctx.s.usage.speechOvertimeCreditMs ?? 0) + o;
  }
}

/** Session end as the UI should show it: the stored end plus the hold / speech overtime currently in progress. */
export function effectiveSessionEndMs(s: ForumEngineState, now: number): number {
  return s.settings.sessionEndsAtMs + holdCreditMs(s, now) + speechOvertimeMs(s, now);
}

const names = (s: ForumEngineState, ids: SeatId[]) => ids.map((id) => s.seats[id]?.countryName ?? id).join(", ");

const EXPIRY_RECORD: Record<string, (who: string, min: string) => string> = {
  attendance: (w, m) => `${w} did not answer the roll call within ${m}; no attendance was chosen for them (they remain not recorded as present).`,
  start_speech: (w, m) => `${w} did not start speaking within ${m}; the turn ended without a speech (no response).`,
  confirm_transcript: (w, m) => `${w} did not confirm the transcript within ${m}.`,
  motion: (w, m) => `${w} did not respond within ${m}; treated as having no motion.`,
  voting_motion: (w, m) => `${w} did not respond within ${m}; treated as having no motion.`,
  division: (w, m) => `${w} did not respond within ${m}; treated as having no division proposal.`,
  vote: (w, m) => `${w} did not vote within ${m}; recorded as not voting (not as abstaining). The vote is counted.`,
  volunteer: (w, m) => `${w} did not respond within ${m}; treated as not volunteering this round.`,
  sponsor: (w, m) => `${w} did not respond as sponsor within ${m}; friendly consent not obtained (not an objection).`,
};

/**
 * Called when the phase's timer fires. Returns "held" if the phase must keep waiting for online humans;
 * otherwise records what happens to pending humans (expired / offline) and lets the phase end normally.
 * App policy H1 (nobody online) is checked BEFORE this and takes precedence.
 */
function waitGate(ctx: Ctx): "held" | "go" {
  const s = ctx.s;
  if (!W(s)) return "go";
  const p = s.phase as Phase & { wait?: ResponseWait };
  const w = p.wait;
  if (!w) return "go";
  const v = responseView(s, engineVoted(s));
  if (!v || !v.holds || v.pending.length === 0) return "go";
  const min = `${Math.round(responseWaitSec(s) / 60 * 10) / 10} min`;
  if (ctx.now >= w.responseDeadlineMs) {
    const text = EXPIRY_RECORD[v.kind]?.(names(s, v.pending), min);
    if (text) record(ctx, { source: "chair", substantive: false, kind: "response_timeout", text: `Response time expired (app policy W1): ${text}` });
    return "go";
  }
  // Pending humans keep their whole window whether or not they are connected right now (a dropped connection
  // or a refresh never shortens it). Only H1 (nobody online at all) stops the meeting, and it is checked first.
  w.holding = true;
  setPhaseDeadline(p, w.responseDeadlineMs);
  schedule(ctx, w.responseDeadlineMs);
  ctx.notes.push(`held for ${v.pending.join(",")}`);
  return "held";
}

/** What counts as "the same situation" for a standing "no motion": statements, speakers, documents, amendments, speaking time. */
export function floorContextKey(s: ForumEngineState): string {
  const docs = Object.values(s.documents).map((d) => `${d.id}:${d.status}:${d.version}`).sort().join(",");
  const am = Object.values(s.amendments).map((a) => `${a.id}:${a.status}`).sort().join(",");
  return `${s.contextSeq}|${s.speakersList.join(",")}|${docs}|${am}|${s.speakingTimeSec}|${s.debateClosed}`;
}

/** Every AI delegation has finished its part of the current phase (if not, the phase's normal timer applies). */
function aiDone(s: ForumEngineState): boolean {
  const p = s.phase;
  const ai = aiSeats(s);
  switch (p.type) {
    case "ROLL_CALL":
      return Object.values(s.seats).filter((x) => x.kind === "ai").every(isPresent);
    case "FLOOR_OPEN":
    case "VP_FLOOR":
    case "DIVISION_PROPOSALS":
      return ai.every((a) => p.aiDoneSeats.includes(a));
    case "MOTION_VOTE":
    case "VOTING_PROCEDURE": {
      const b = p.ballotId ? s.ballots[p.ballotId] : undefined;
      return !!b && Object.keys(b.eligible).filter((x) => s.seats[x].kind === "ai").every((x) => b.votes[x] !== undefined);
    }
    default:
      return false; // e.g. caucus volunteering: AI intent is only known when it volunteers → normal timer
  }
}

/** After a human (or AI) response: if nobody is awaited any more, the phase continues at once. */
function maybeAdvanceOnResponse(ctx: Ctx) {
  const s = ctx.s;
  if (!W(s) || s.paused) return;
  const w = (s.phase as { wait?: ResponseWait }).wait;
  if (!w) return;
  const v = responseView(s, engineVoted(s));
  if (!v || v.pending.length > 0) return;
  if (!(aiDone(s) || ctx.now >= w.baseDeadlineMs)) return;
  // Humans answered only through a standing choice: keep the window open for its normal time (they can still act).
  if (v.standing.length > 0 && ctx.now < w.baseDeadlineMs) return;
  endPhase(ctx);
}

function record(ctx: Ctx, e: Omit<RecordEntry, "seq" | "atMs" | "phaseId">) {
  ctx.s.recordSeq += 1;
  if (e.substantive) ctx.s.contextSeq += 1;
  const entry: RecordEntry = { ...e, seq: ctx.s.recordSeq, atMs: ctx.now, phaseId: ctx.s.phaseId };
  ctx.effects.push({ type: "record", entry });
}

function announce(ctx: Ctx, text: string) {
  ctx.effects.push({ type: "announce", text });
}

function seat(ctx: Ctx, id: SeatId): Seat {
  const st = ctx.s.seats[id];
  if (!st) reject("unknown_seat", `Unknown seat ${id}`);
  return st as Seat;
}

/** The actor must control this seat: humans by uid, AI by its own seat id. System never acts as a seat. */
function requireSeatActor(ctx: Ctx, id: SeatId): Seat {
  const st = seat(ctx, id);
  const a = ctx.actor;
  if (a.kind === "human" && st.kind === "human" && st.uid === a.uid) return st;
  if (a.kind === "ai" && st.kind === "ai" && a.seat === id) return st;
  return reject("forbidden_seat", "Actor does not control this seat");
}

function requireOwner(ctx: Ctx) {
  if (!(ctx.actor.kind === "human" && ctx.actor.uid === ctx.s.ownerUid)) reject("owner_only", "Room owner only");
}

function requireSystem(ctx: Ctx) {
  if (ctx.actor.kind !== "system") reject("system_only", "Server-only command");
}

function presentSeats(s: ForumEngineState): Seat[] {
  return Object.values(s.seats).filter(isPresent);
}

function aiSeats(s: ForumEngineState, presentOnly = true): SeatId[] {
  return Object.values(s.seats)
    .filter((x) => x.kind === "ai" && (!presentOnly || isPresent(x)))
    .map((x) => x.id);
}

function sessionOver(ctx: Ctx) {
  return ctx.now >= effectiveSessionEndMs(ctx.s, ctx.now);
}

// ── debate flow ──────────────────────────────────────────────────

function slotSeconds(ctx: Ctx, context: SpeechContext): number {
  if (context.kind === "mod_caucus") return ctx.s.activeCaucus?.speakingSec ?? ctx.s.speakingTimeSec;
  if (context.kind === "yield") return context.sec;
  return ctx.s.speakingTimeSec;
}

function startSpeakerSlot(ctx: Ctx, id: SeatId, context: SpeechContext) {
  const st = seat(ctx, id);
  const t = ctx.s.settings.timers;
  if (st.kind === "human") {
    transition(ctx, { type: "SPEECH_PREP", seat: id, deadlineMs: ctx.now + t.humanPrepSec * 1000, context });
  } else {
    transition(ctx, {
      type: "AI_SPEECH_PENDING",
      seat: id,
      requiredContextSeq: ctx.s.contextSeq,
      deadlineMs: ctx.now + t.aiSpeechReadyTimeoutSec * 1000,
      context,
    });
    ctx.effects.push({
      type: "ai_speech_needed",
      seat: id,
      contextSeq: ctx.s.contextSeq,
      maxWords: Math.floor(slotSeconds(ctx, context) * 2.3),
      context,
    });
  }
}

function nextSpeakerOrFloor(ctx: Ctx, origin: "after_motions" | "after_resume" | "empty_list") {
  if (sessionOver(ctx)) return sessionEnd(ctx);
  const next = ctx.s.speakersList.shift();
  if (next) return startSpeakerSlot(ctx, next, { kind: "speakers_list" });
  openFloor(ctx, origin === "after_resume" ? "after_resume" : "empty_list");
}

function openFloor(ctx: Ctx, origin: Extract<Phase, { type: "FLOOR_OPEN" }>["origin"]) {
  if (sessionOver(ctx)) return sessionEnd(ctx);
  transition(ctx, {
    type: "FLOOR_OPEN",
    windowId: "",
    deadlineMs: ctx.now + ctx.s.settings.timers.motionWindowSec * 1000,
    origin,
    readySeats: [],
    aiDoneSeats: [],
    extensionUsedSec: 0,
  });
  const p = ctx.s.phase as Extract<Phase, { type: "FLOOR_OPEN" }>;
  p.windowId = ctx.s.phaseId;
  // Carried motions (open decision "carry_over_to_next_window") join this window and are voted first by precedence.
  for (const id of ctx.s.carriedMotionIds) {
    const m = ctx.s.motions[id];
    if (m && m.status === "pending") {
      m.carriedFromWindowId = m.windowId;
      m.windowId = p.windowId; // re-validated when this window closes (D3)
    }
  }
  ctx.s.carriedMotionIds = [];
  if (W(ctx.s) && ctx.s.standingNoMotion) {
    const key = floorContextKey(ctx.s);
    const standing = Object.values(ctx.s.seats)
      .filter((x) => x.kind === "human" && isPresent(x) && ctx.s.standingNoMotion![x.id] === key)
      .map((x) => x.id);
    if (standing.length) p.standingSeats = standing;
  }
  ctx.effects.push({ type: "ai_floor_decision_needed", windowId: p.windowId, contextSeq: ctx.s.contextSeq });
}

function afterSpeech(ctx: Ctx, context: SpeechContext) {
  if (context.kind === "mod_caucus") {
    const c = ctx.s.activeCaucus;
    if (c) {
      c.usedSec += c.speakingSec ?? ctx.s.speakingTimeSec; // rule 10: each speech counts its full speaking time
      if (ctx.actorSeatLast) c.spokenSeats.push(ctx.actorSeatLast);
    }
    return continueModCaucus(ctx);
  }
  if (context.kind === "dr_panel") return openFloor(ctx, "after_motions");
  openFloor(ctx, "after_speech");
}

function endSpeechSlot(ctx: Ctx, id: SeatId, context: SpeechContext) {
  ctx.actorSeatLast = id;
  const p = ctx.s.phase;
  if (p.type === "SPEECH_CONFIRM" && p.yieldTo && context.kind === "speakers_list") {
    const y = p.yieldTo;
    const to = ctx.s.seats[y.seat];
    if (to && isPresent(to)) {
      record(ctx, { source: "chair", substantive: false, text: `${ctx.s.seats[id].countryName} yields ${y.sec}s to ${to.countryName} (rule 18).` });
      return startSpeakerSlot(ctx, y.seat, { kind: "yield", from: id, sec: y.sec });
    }
  }
  afterSpeech(ctx, context);
}

/**
 * D6 (app policy, time-based simulation — NOT a motion to close debate). Only called at phase
 * boundaries, so a running vote, its reading time or a speech in progress is never cut short.
 */
function sessionEnd(ctx: Ctx) {
  const pol = ctx.s.settings.policies.sessionEnd;
  if (pol === "enter_voting_if_resolutions_introduced" && ctx.s.introducedResolutionIds.length > 0 && !ctx.s.debateClosed) {
    record(ctx, {
      source: "chair",
      substantive: true,
      text: "Session time is over. Under the forum's time-based simulation rule (app policy, not a motion), the committee moves to final voting on the introduced resolutions.",
    });
    return enterVotingProcedure(ctx);
  }
  record(ctx, {
    source: "chair",
    substantive: true,
    text:
      ctx.s.introducedResolutionIds.length === 0
        ? "Session time is over. No resolution was introduced, so no resolution was adopted."
        : "Session time is over.",
  });
  close(ctx, "session_time_over");
}

function close(ctx: Ctx, reason: string) {
  ctx.s.activeCaucus = null;
  for (const m of Object.values(ctx.s.motions)) {
    if (m.status === "pending" || m.status === "voting") {
      m.status = "obsolete";
      m.disposition = { reason: `forum closed (${reason})`, source: "official" };
    }
  }
  ctx.s.carriedMotionIds = [];
  for (const b of Object.values(ctx.s.ballots)) if (b.status === "reading" || b.status === "open") b.status = "not_held";
  ctx.s.speakersList = [];
  transition(ctx, { type: "CLOSED", reason });
  ctx.effects.push({ type: "forum_closed", reason });
}

// ── motions & procedural ballots ─────────────────────────────────

function windowMotions(ctx: Ctx, windowId: string): Motion[] {
  return Object.values(ctx.s.motions).filter((m) => m.windowId === windowId && m.status === "pending");
}

function closeFloor(ctx: Ctx) {
  const p = ctx.s.phase as Extract<Phase, { type: "FLOOR_OPEN" }>;
  const pending = windowMotions(ctx, p.windowId);
  const valid: Motion[] = [];
  for (const m of pending) {
    // Re-validated at close: conditions can change while the window is open (e.g. session time).
    const v = validateMotion(ctx.s, m.mover, m.params, ctx.now);
    if (v.ok) valid.push(m);
    else {
      m.status = "obsolete";
      m.disposition = { reason: v.message, source: v.source };
    }
  }
  if (valid.length === 0) {
    if (p.origin === "after_caucus" || p.origin === "after_speech" || p.origin === "after_motions") {
      return nextSpeakerOrFloor(ctx, "after_motions");
    }
    return nextSpeakerOrFloor(ctx, "empty_list");
  }
  valid.sort(compareMotions);
  startMotionBallot(ctx, p.windowId, valid.map((m) => m.id));
}

function startMotionBallot(ctx: Ctx, windowId: string, queue: string[]) {
  while (queue.length > 0) {
    const motionId = queue[0];
    const m = ctx.s.motions[motionId];
    const ballot = openBallot({
      id: newId(ctx, "b"),
      kind: "procedural",
      threshold: motionThreshold(m.params.type, ctx.s),
      subject: { type: "motion", motionId },
      seats: ctx.s.seats,
      nowMs: ctx.now,
    });
    ctx.s.ballots[ballot.id] = ballot;
    m.ballotId = ballot.id;
    if (!ballot.quorumMet) {
      record(ctx, {
        source: "chair",
        substantive: false,
        text: `Vote NOT HELD on motion (${m.params.type}) by ${m.mover}: no voting quorum (${ballot.presentAtOpen} present, ${ballot.quorumRequired} required, rule 32). This is not a rejection; the motion may be moved again.`,
      });
      if (ctx.s.settings.policies.noVotingQuorum === "motion_carried_to_next_window") {
        ctx.s.carriedMotionIds.push(motionId);
        m.disposition = { reason: "no voting quorum; carried", source: "app_policy" };
      } else {
        m.status = "not_held";
        m.disposition = { reason: "no voting quorum — vote not held (D7)", source: "app_policy" };
      }
      queue.shift();
      continue;
    }
    m.status = "voting";
    transition(ctx, {
      type: "MOTION_VOTE",
      windowId,
      queue: queue.slice(1),
      currentMotionId: motionId,
      ballotId: ballot.id,
      stage: "reading",
      deadlineMs: ctx.now + ctx.s.settings.timers.readingSec * 1000,
    });
    return;
  }
  nextSpeakerOrFloor(ctx, "after_motions"); // rule 15: all motions failed / none held
}

function connectionMap(s: ForumEngineState) {
  const c: Record<SeatId, "online" | "offline"> = {};
  for (const st of Object.values(s.seats)) c[st.id] = st.kind === "ai" ? "online" : st.connection;
  return c;
}

function closeBallot(ctx: Ctx, b: Ballot) {
  const pol = b.kind === "procedural" ? ctx.s.settings.policies.proceduralNonResponse : ctx.s.settings.policies.substantiveNonResponse;
  b.connectionAtClose = connectionMap(ctx.s);
  b.result = tally(b, pol, b.connectionAtClose);
  b.status = "closed";
}

function finishMotionVote(ctx: Ctx) {
  const p = ctx.s.phase as Extract<Phase, { type: "MOTION_VOTE" }>;
  const b = ctx.s.ballots[p.ballotId];
  closeBallot(ctx, b);
  const m = ctx.s.motions[p.currentMotionId];
  const r = b.result!;
  const passed = r.passed;
  m.status = passed ? "adopted" : "rejected";
  record(ctx, {
    source: "chair",
    substantive: true,
    text: `Motion (${m.params.type}) by ${m.mover} ${passed ? "ADOPTED" : "FAILED"}: Yes ${r.yes}, No ${r.no}` +
      (r.notVoted.length ? `, did not vote ${r.notVoted.length}` : "") + ` [${r.formula}]`,
  });
  if (!passed) return startMotionBallot(ctx, p.windowId, [...p.queue]);
  adoptMotion(ctx, m, [...p.queue]);
}

function adoptMotion(ctx: Ctx, m: Motion, remaining: string[]) {
  const policy = ctx.s.settings.policies.remainingMotionsAfterModeChange;
  const keep: string[] = [];
  for (const id of remaining) {
    const o = ctx.s.motions[id];
    const row = dispositionAfterAdoption(m.params.type, o.params.type);
    if (row.disposition === "continue_voting") {
      keep.push(id);
      continue;
    }
    if (row.disposition === "deferred") {
      if (policy === "carry_over_to_next_window") {
        ctx.s.carriedMotionIds.push(id);
        o.disposition = { reason: `carried after ${m.params.type}`, source: "open_decision" };
      } else {
        o.status = "lapsed";
        o.disposition = { reason: `lapsed after ${m.params.type}`, source: "open_decision" };
      }
      continue;
    }
    o.status = row.disposition === "obsolete" ? "obsolete" : "lapsed";
    o.disposition = { reason: row.rationale, source: row.source };
  }

  const p = m.params;
  switch (p.type) {
    case "adjourn":
      return close(ctx, "adjourned");
    case "suspend":
      return transition(ctx, { type: "SUSPENDED", resumeAtMs: ctx.now + p.durationSec * 1000 });
    case "extend_caucus": {
      const last = ctx.s.lastEndedCaucus!;
      return startCaucus(ctx, {
        kind: last.kind,
        motionId: m.id,
        topic: last.topic,
        speakingSec: last.speakingSec,
        totalSec: p.durationSec,
        usedSec: 0,
        spokenSeats: [],
        isExtension: true,
      });
    }
    case "unmod_caucus":
      return startCaucus(ctx, { kind: "unmod", motionId: m.id, totalSec: p.totalSec, usedSec: 0, spokenSeats: [], isExtension: false });
    case "mod_caucus":
      return startCaucus(ctx, {
        kind: "mod",
        motionId: m.id,
        topic: p.topic,
        speakingSec: p.speakingSec,
        totalSec: p.totalSec,
        usedSec: 0,
        spokenSeats: [],
        isExtension: false,
      });
    case "set_speaking_time":
      ctx.s.speakingTimeSec = p.speakingSec;
      if (keep.length) return startMotionBallot(ctx, (ctx.s.phase as { windowId: string }).windowId, keep);
      return nextSpeakerOrFloor(ctx, "after_motions");
    case "introduce_resolution": {
      const approved = Object.values(ctx.s.documents)
        .filter((d) => d.kind === "draft_resolution" && d.status === "approved")
        .sort((a, b) => a.submittedAtMs - b.submittedAtMs || a.id.localeCompare(b.id));
      for (const d of approved) {
        d.status = "introduced";
        ctx.s.introducedResolutionIds.push(d.id);
        record(ctx, { source: "chair", substantive: true, text: `Draft resolution "${d.title}" (${d.id} v${d.version}) introduced.` });
      }
      return transition(ctx, {
        type: "DR_INTRO",
        queue: approved.slice(1).map((d) => d.id),
        docId: approved[0].id,
        stage: "presentation",
        deadlineMs: ctx.now + ctx.s.settings.timers.drPresentationSec * 1000,
      });
    }
    case "introduce_amendment": {
      const a = ctx.s.amendments[p.amendmentId];
      a.status = "awaiting_sponsors";
      transition(ctx, {
        type: "AMENDMENT_SPONSOR_RESPONSE",
        amendmentId: a.id,
        deadlineMs: ctx.now + ctx.s.settings.timers.sponsorResponseSec * 1000,
        responses: {},
        waitExtended: false,
      });
      const sponsors = ctx.s.documents[a.targetDocId].sponsors.filter((sid) => ctx.s.seats[sid]?.kind === "ai");
      if (sponsors.length) ctx.effects.push({ type: "ai_sponsor_response_needed", amendmentId: a.id, seats: sponsors });
      return;
    }
    case "enter_voting":
      return enterVotingProcedure(ctx);
    default:
      return reject("not_supported_yet", "Motion not implemented");
  }
}

function startCaucus(ctx: Ctx, c: CaucusState) {
  ctx.s.activeCaucus = c;
  if (c.kind === "unmod") {
    transition(ctx, { type: "UNMOD_CAUCUS", deadlineMs: ctx.now + c.totalSec * 1000, readySeats: [] });
    const ai = aiSeats(ctx.s);
    if (ai.length) ctx.effects.push({ type: "ai_caucus_work_needed", phaseId: ctx.s.phaseId, seats: ai });
  } else {
    openVolunteerWindow(ctx);
  }
}

function openVolunteerWindow(ctx: Ctx) {
  transition(ctx, { type: "MOD_CAUCUS", deadlineMs: ctx.now + ctx.s.settings.timers.volunteerWindowSec * 1000, volunteers: [] });
  const ai = aiSeats(ctx.s);
  if (ai.length) ctx.effects.push({ type: "ai_volunteer_needed", phaseId: ctx.s.phaseId, seats: ai });
}

function continueModCaucus(ctx: Ctx) {
  const c = ctx.s.activeCaucus!;
  if (c.usedSec + (c.speakingSec ?? 0) > c.totalSec || sessionOver(ctx)) return endCaucus(ctx);
  openVolunteerWindow(ctx);
}

function endCaucus(ctx: Ctx) {
  const c = ctx.s.activeCaucus;
  if (c) ctx.s.lastEndedCaucus = { ...c, endedPhaseId: ctx.s.phaseId };
  ctx.s.activeCaucus = null;
  openFloor(ctx, "after_caucus");
}

function pickVolunteer(ctx: Ctx, volunteers: SeatId[]): SeatId {
  // App policy: delegations that have not yet spoken in this caucus first, humans before AI, then sign-up order.
  const c = ctx.s.activeCaucus!;
  const rank = (id: SeatId) => [c.spokenSeats.includes(id) ? 1 : 0, ctx.s.seats[id].kind === "human" ? 0 : 1];
  return [...volunteers].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || volunteers.indexOf(a) - volunteers.indexOf(b);
  })[0];
}

// ── voting procedure (substantive) ───────────────────────────────

type VpPhase = Extract<Phase, { type: "VOTING_PROCEDURE" }>;

function divisionsOf(s: ForumEngineState) {
  s.divisions ??= {};
  s.divisionProposals ??= {};
  return { divisions: s.divisions, proposals: s.divisionProposals };
}

/** Items for one resolution: its unfriendly amendments (rule 29), the division window (rule 33), then the resolution. */
function docItems(ctx: Ctx, docId: string): VotingItem[] {
  const items: VotingItem[] = [];
  for (const a of Object.values(ctx.s.amendments)) {
    if (a.targetDocId === docId && a.status === "unfriendly_pending") items.push({ kind: "amendment", id: a.id });
  }
  items.push({ kind: "vp_floor", target: "division", docId });
  items.push({ kind: "resolution", id: docId });
  return items;
}

function enterVotingProcedure(ctx: Ctx) {
  ctx.s.debateClosed = true;
  for (const id of ctx.s.carriedMotionIds) {
    const m = ctx.s.motions[id];
    if (m) {
      m.status = "obsolete";
      m.disposition = { reason: "Rule 13: debate closed", source: "official" };
    }
  }
  ctx.s.carriedMotionIds = [];
  divisionsOf(ctx.s);
  // Rule 34 (official): default order = order of introduction.
  const order = ctx.s.introducedResolutionIds.filter((id) => ctx.s.documents[id]?.status === "introduced");
  ctx.s.votingOrder = order;
  const queue: VotingItem[] = [];
  if (order.length >= 2) queue.push({ kind: "vp_floor", target: "order" });
  for (const id of order) queue.push(...docItems(ctx, id));
  transition(ctx, { type: "VOTING_PROCEDURE", queue, ballotId: null, stage: "between", deadlineMs: ctx.now });
  nextVotingItem(ctx, queue);
}

function openVpFloor(ctx: Ctx, item: Extract<VotingItem, { kind: "vp_floor" }>, queue: VotingItem[]) {
  if (item.target === "order") {
    if ((ctx.s.votingOrder?.length ?? 0) < 2 || ctx.s.reorderAdopted) return nextVotingItem(ctx, queue);
  } else {
    const doc = ctx.s.documents[item.docId];
    // Division needs at least two operative clauses; preambular clauses cannot be divided (rule 33).
    if (!doc || doc.status !== "introduced" || doc.operative.length < 2 || divisionsOf(ctx.s).divisions[item.docId]) {
      return nextVotingItem(ctx, queue);
    }
  }
  transition(ctx, {
    type: "VP_FLOOR",
    windowId: "",
    target: item.target === "order" ? { kind: "order" } : { kind: "division", docId: item.docId },
    deadlineMs: ctx.now + ctx.s.settings.timers.motionWindowSec * 1000,
    readySeats: [],
    aiDoneSeats: [],
    queue,
  });
  const p = ctx.s.phase as Extract<Phase, { type: "VP_FLOOR" }>;
  p.windowId = ctx.s.phaseId;
  const ai = aiSeats(ctx.s);
  if (ai.length) ctx.effects.push({ type: "ai_voting_motion_needed", phaseId: ctx.s.phaseId, seats: ai });
}

function closeVpFloor(ctx: Ctx) {
  const p = ctx.s.phase as Extract<Phase, { type: "VP_FLOOR" }>;
  const valid: Motion[] = [];
  for (const m of windowMotions(ctx, p.windowId)) {
    const v = validateMotion(ctx.s, m.mover, m.params, ctx.now);
    if (v.ok) valid.push(m);
    else {
      m.status = "obsolete";
      m.disposition = { reason: v.message, source: v.source };
    }
  }
  // Rule 34: reorder proposals are voted in the order received. Rule 33: one motion to divide per resolution.
  valid.sort((a, b) => a.submittedAtMs - b.submittedAtMs || a.id.localeCompare(b.id));
  const queue: VotingItem[] = [...valid.map((m) => ({ kind: "motion" as const, id: m.id })), ...p.queue];
  transition(ctx, { type: "VOTING_PROCEDURE", queue, ballotId: null, stage: "between", deadlineMs: ctx.now });
  nextVotingItem(ctx, queue);
}

function maybeCloseWindowEarly(ctx: Ctx) {
  const p = ctx.s.phase as { readySeats: SeatId[]; aiDoneSeats: SeatId[] };
  const humans = Object.values(ctx.s.seats).filter(isHumanOnlinePresent).map((x) => x.id);
  const ais = aiSeats(ctx.s);
  if (!(humans.every((h) => p.readySeats.includes(h)) && ais.every((a) => p.aiDoneSeats.includes(a)))) return;
  if (ctx.s.phase.type === "FLOOR_OPEN") return closeFloor(ctx);
  if (ctx.s.phase.type === "VP_FLOOR") return closeVpFloor(ctx);
  if (ctx.s.phase.type === "DIVISION_PROPOSALS") return closeDivisionProposals(ctx);
}

/** Rule 33 (rule interpretation for ordering): more parts = more disruptive; ties by submission time. */
export function compareDivisionProposals(a: DivisionProposal, b: DivisionProposal) {
  return b.parts.length - a.parts.length || a.submittedAtMs - b.submittedAtMs || a.id.localeCompare(b.id);
}

/** Normalises a proposal: listed groups + one group of remaining clauses. Returns an error message or the parts. */
export function normaliseDivision(operativeCount: number, groups: number[][]): { ok: true; parts: number[][] } | { ok: false; error: string } {
  const seen = new Set<number>();
  const parts: number[][] = [];
  for (const g of groups) {
    if (!Array.isArray(g) || g.length === 0) return { ok: false, error: "Each part needs at least one operative clause" };
    const part = [...new Set(g)].sort((x, y) => x - y);
    for (const i of part) {
      if (!Number.isInteger(i) || i < 0 || i >= operativeCount) return { ok: false, error: `Clause ${i + 1} does not exist` };
      if (seen.has(i)) return { ok: false, error: `Clause ${i + 1} appears in two parts` };
      seen.add(i);
    }
    parts.push(part);
  }
  const rest = [...Array(operativeCount).keys()].filter((i) => !seen.has(i));
  if (rest.length) parts.push(rest);
  if (parts.length < 2) return { ok: false, error: "A division must create at least two parts" };
  parts.sort((x, y) => x[0] - y[0]);
  return { ok: true, parts };
}

function startDivisionProposals(ctx: Ctx, docId: string, queue: VotingItem[]) {
  const doc = ctx.s.documents[docId];
  divisionsOf(ctx.s).divisions[docId] = { docId, baseVersion: doc.version, baseOperative: [...doc.operative], proposals: [] };
  transition(ctx, {
    type: "DIVISION_PROPOSALS",
    docId,
    deadlineMs: ctx.now + ctx.s.settings.timers.motionWindowSec * 2 * 1000,
    readySeats: [],
    aiDoneSeats: [],
    queue,
  });
  const ai = aiSeats(ctx.s);
  if (ai.length) ctx.effects.push({ type: "ai_voting_motion_needed", phaseId: ctx.s.phaseId, seats: ai });
}

function closeDivisionProposals(ctx: Ctx) {
  const p = ctx.s.phase as Extract<Phase, { type: "DIVISION_PROPOSALS" }>;
  const { divisions, proposals } = divisionsOf(ctx.s);
  const div = divisions[p.docId];
  const list = div.proposals.map((id) => proposals[id]).filter((x) => x.status === "pending").sort(compareDivisionProposals);
  if (list.length === 0) {
    div.outcome = "intact";
    record(ctx, { source: "chair", substantive: true, text: `No proposal to divide "${ctx.s.documents[p.docId].title}" was made; it remains intact (rule 33).` });
  } else {
    record(ctx, {
      source: "chair",
      substantive: false,
      text: `Division proposals will be voted from most to least disruptive (rule 33; more parts first — rule interpretation): ${list.map((x) => `${x.id} (${x.parts.length} parts)`).join(", ")}.`,
    });
  }
  const queue: VotingItem[] = [...list.map((x) => ({ kind: "division_proposal" as const, id: x.id })), ...p.queue];
  transition(ctx, { type: "VOTING_PROCEDURE", queue, ballotId: null, stage: "between", deadlineMs: ctx.now });
  nextVotingItem(ctx, queue);
}

function recombine(ctx: Ctx, docId: string, queue: VotingItem[]) {
  const { divisions, proposals } = divisionsOf(ctx.s);
  const div = divisions[docId];
  const doc = ctx.s.documents[docId];
  const pr = proposals[div.adoptedProposalId!];
  const results = div.partResults ?? [];
  if (results.some((x) => x === null || x === undefined)) {
    div.outcome = "intact";
    record(ctx, { source: "chair", substantive: true, text: `A vote on a divided part of "${doc.title}" was not held; the text remains intact (app policy).` });
    return nextVotingItem(ctx, queue);
  }
  const included = pr.parts.filter((_, i) => results[i]).flatMap((x) => x.clauses).sort((a, b) => a - b);
  if (included.length === 0) {
    div.outcome = "rejected_as_whole";
    doc.status = "failed";
    record(ctx, { source: "chair", substantive: true, text: `All divided operative parts of "${doc.title}" were rejected; the resolution is rejected as a whole (rule 33).` });
    return nextVotingItem(ctx, queue.filter((x) => !(x.kind === "resolution" && x.id === docId)));
  }
  div.outcome = "recombined";
  if (included.length < div.baseOperative.length) {
    doc.operative = included.map((i) => div.baseOperative[i]);
    doc.version += 1;
    doc.textHash = docTextHash(doc);
  }
  record(ctx, {
    source: "chair",
    substantive: true,
    text: `"${doc.title}" recombined (rule 33): operative clauses ${included.map((i) => i + 1).join(", ")} of v${div.baseVersion} kept; now v${doc.version}. The final vote is on this text.`,
  });
  return nextVotingItem(ctx, queue);
}

function nextVotingItem(ctx: Ctx, queue: VotingItem[]): void {
  const item = queue.shift();
  if (!item) return close(ctx, "voting_completed");
  if (item.kind === "vp_floor") return openVpFloor(ctx, item, queue);
  if (item.kind === "recombine") return recombine(ctx, item.docId, queue);
  const { divisions, proposals } = divisionsOf(ctx.s);
  let subject: Ballot["subject"];
  let threshold: Ballot["threshold"] = "simple_majority";
  let kind: Ballot["kind"] = "substantive";
  let label: string;
  switch (item.kind) {
    case "amendment": {
      const a = ctx.s.amendments[item.id];
      const doc = ctx.s.documents[a.targetDocId];
      const err = doc.status === "introduced" ? validateAmendmentOp(doc, a.op) : "resolution no longer on the floor";
      if (err) {
        a.status = "failed";
        announce(ctx, `Amendment ${a.id} cannot be applied to the current text (${err}).`);
        return nextVotingItem(ctx, queue);
      }
      subject = { type: "amendment", amendmentId: a.id, textHash: a.textHash };
      threshold = "two_thirds"; // rule 29 (official): unfriendly amendment needs 2/3 substantive vote
      label = `amendment ${a.id}`;
      break;
    }
    case "resolution": {
      const doc = ctx.s.documents[item.id];
      if (doc.status !== "introduced") return nextVotingItem(ctx, queue);
      subject = { type: "resolution", docId: doc.id, version: doc.version, textHash: doc.textHash };
      label = `resolution ${doc.id} v${doc.version}`; // rule 26 (official): simple majority
      break;
    }
    case "motion": {
      const m = ctx.s.motions[item.id];
      if (!m || m.status !== "pending") return nextVotingItem(ctx, queue);
      subject = { type: "motion", motionId: m.id };
      kind = "procedural"; // rules 33/34: procedural, simple majority
      threshold = motionThreshold(m.params.type, ctx.s);
      label = `motion (${m.params.type}) by ${m.mover}`;
      break;
    }
    case "division_proposal": {
      const pr = proposals[item.id];
      if (!pr || pr.status !== "pending") return nextVotingItem(ctx, queue);
      subject = { type: "division_proposal", docId: pr.docId, proposalId: pr.id, textHash: ctx.s.documents[pr.docId].textHash };
      label = `division proposal ${pr.id}`; // rule 33: substantive, simple majority
      break;
    }
    case "division_part": {
      subject = { type: "division_part", docId: item.docId, part: item.part, textHash: ctx.s.documents[item.docId].textHash };
      label = `part ${item.part + 1} of "${ctx.s.documents[item.docId].title}"`; // rule 33: inclusion, simple majority
      break;
    }
  }
  const b = openBallot({ id: newId(ctx, "b"), kind, threshold, subject, seats: ctx.s.seats, nowMs: ctx.now });
  ctx.s.ballots[b.id] = b;
  if (!b.quorumMet) {
    record(ctx, {
      source: "chair",
      substantive: true,
      text: `Vote NOT HELD on ${label}: no voting quorum (${b.presentAtOpen} present, ${b.quorumRequired} required, rule 32). Not a rejection.`,
    });
    if (item.kind === "resolution") ctx.s.documents[item.id].status = "not_voted";
    else if (item.kind === "amendment") ctx.s.amendments[item.id].status = "not_held";
    else if (item.kind === "motion") {
      ctx.s.motions[item.id].status = "not_held";
      ctx.s.motions[item.id].disposition = { reason: "no voting quorum — vote not held (D7)", source: "app_policy" };
    } else if (item.kind === "division_proposal") proposals[item.id].status = "not_held";
    else if (item.kind === "division_part") (divisions[item.docId].partResults ??= [])[item.part] = null;
    return nextVotingItem(ctx, queue);
  }
  if (item.kind === "motion") {
    ctx.s.motions[item.id].status = "voting";
    ctx.s.motions[item.id].ballotId = b.id;
  }
  if (item.kind === "division_proposal") proposals[item.id].status = "voting";
  transition(ctx, {
    type: "VOTING_PROCEDURE",
    queue,
    ballotId: b.id,
    stage: "reading",
    deadlineMs: ctx.now + ctx.s.settings.timers.readingSec * 1000,
  });
}

function finishSubstantiveVote(ctx: Ctx) {
  const p = ctx.s.phase as VpPhase;
  const b = ctx.s.ballots[p.ballotId!];
  closeBallot(ctx, b);
  const r = b.result!;
  const tallyText = `Yes ${r.yes}, No ${r.no}${b.kind === "substantive" ? `, Abstain ${r.abstain}` : ""}${r.notVoted.length ? `, did not vote ${r.notVoted.length}` : ""} [${r.formula}]`;
  let queue = [...p.queue];
  const { divisions, proposals } = divisionsOf(ctx.s);
  const sub = b.subject;
  if (sub.type === "amendment") {
    const a = ctx.s.amendments[sub.amendmentId];
    if (r.passed) {
      const doc = ctx.s.documents[a.targetDocId];
      doc.operative = applyAmendmentOp(doc, a.op);
      doc.version += 1;
      doc.textHash = docTextHash(doc);
      a.status = "adopted";
    } else a.status = "failed";
    record(ctx, { source: "chair", substantive: true, text: `Amendment ${a.id} ${r.passed ? "ADOPTED" : "FAILED"}: ${tallyText}` });
  } else if (sub.type === "resolution") {
    const doc = ctx.s.documents[sub.docId];
    doc.status = r.passed ? "adopted" : "failed";
    record(ctx, { source: "chair", substantive: true, text: `Resolution "${doc.title}" v${sub.version} ${r.passed ? "ADOPTED" : "NOT ADOPTED"}: ${tallyText}` });
  } else if (sub.type === "motion") {
    const m = ctx.s.motions[sub.motionId];
    m.status = r.passed ? "adopted" : "rejected";
    record(ctx, { source: "chair", substantive: true, text: `Motion (${m.params.type}) by ${m.mover} ${r.passed ? "ADOPTED" : "FAILED"}: ${tallyText}` });
    if (r.passed && m.params.type === "reorder_resolutions") {
      // Rule 34: once a proposal passes, all others are discarded.
      for (const it of queue) {
        if (it.kind === "motion" && ctx.s.motions[it.id]?.params.type === "reorder_resolutions") {
          ctx.s.motions[it.id].status = "obsolete";
          ctx.s.motions[it.id].disposition = { reason: "Rule 34: another ordering proposal passed", source: "official" };
        }
      }
      ctx.s.votingOrder = [...m.params.order];
      ctx.s.reorderAdopted = true;
      queue = m.params.order.flatMap((id) => docItems(ctx, id));
      record(ctx, { source: "chair", substantive: false, text: `Voting order: ${m.params.order.map((id) => `"${ctx.s.documents[id].title}"`).join(", ")} (rule 34).` });
    } else if (r.passed && m.params.type === "divide_question") {
      return startDivisionProposals(ctx, m.params.docId, queue);
    }
  } else if (sub.type === "division_proposal") {
    const pr = proposals[sub.proposalId];
    pr.status = r.passed ? "adopted" : "failed";
    record(ctx, { source: "chair", substantive: true, text: `Division proposal ${pr.id} (${pr.parts.map((x) => x.clauses.map((i) => i + 1).join("+")).join(" | ")}) ${r.passed ? "ADOPTED" : "FAILED"}: ${tallyText}` });
    const div = divisions[pr.docId];
    if (r.passed) {
      // Rule 33: all other proposals are discarded; each part is then voted for inclusion.
      for (const it of queue) if (it.kind === "division_proposal") proposals[it.id].status = "discarded";
      queue = queue.filter((it) => it.kind !== "division_proposal");
      div.adoptedProposalId = pr.id;
      div.partResults = pr.parts.map(() => null);
      queue.unshift(...pr.parts.map((_, i) => ({ kind: "division_part" as const, docId: pr.docId, part: i })), { kind: "recombine", docId: pr.docId });
    } else if (!queue.some((it) => it.kind === "division_proposal")) {
      div.outcome = "intact";
      record(ctx, { source: "chair", substantive: true, text: `No division passed; "${ctx.s.documents[pr.docId].title}" remains intact (rule 33).` });
    }
  } else if (sub.type === "division_part") {
    divisions[sub.docId].partResults![sub.part] = r.passed;
    record(ctx, { source: "chair", substantive: true, text: `Part ${sub.part + 1} of "${ctx.s.documents[sub.docId].title}" ${r.passed ? "INCLUDED" : "EXCLUDED"}: ${tallyText}` });
  }
  transition(ctx, { type: "VOTING_PROCEDURE", queue, ballotId: null, stage: "between", deadlineMs: ctx.now });
  nextVotingItem(ctx, queue);
}

// ── commands ─────────────────────────────────────────────────────

function isHumanOnlinePresent(s: Seat) {
  return s.kind === "human" && isPresent(s) && s.connection === "online";
}

/** App policy replacing the moderator's discretion to end early (rule 11): every online present human is ready. */
function maybeEndUnmodEarly(ctx: Ctx) {
  const up = ctx.s.phase as Extract<Phase, { type: "UNMOD_CAUCUS" }>;
  const humans = Object.values(ctx.s.seats).filter(isHumanOnlinePresent).map((x) => x.id);
  if (humans.length > 0 && humans.every((h) => up.readySeats.includes(h))) endCaucus(ctx);
}

function handleTick(ctx: Ctx) {
  const s = ctx.s;
  if (s.paused) {
    if (s.paused.reason === "no_humans") {
      if (ctx.now < s.paused.autoResumeAtMs) throw new Duplicate();
      s.paused = null;
      record(ctx, { source: "chair", substantive: true, text: "No human delegate returned during the idle hold; the forum is closed (app policy H1)." });
      return close(ctx, "all_humans_left");
    }
    if (ctx.now >= s.paused.autoResumeAtMs) return resume(ctx, "auto");
    throw new Duplicate();
  }
  const d = phaseDeadline(s.phase);
  if (d === null || ctx.now < d) throw new Duplicate(); // early/duplicate scheduler delivery: harmless no-op
  // H1 first: with nobody online, nothing advances and no response window is processed.
  if (!Object.values(s.seats).some((x) => x.kind === "human" && x.connection === "online")) return enterIdleHold(ctx);
  if (waitGate(ctx) === "held") return;
  return endPhase(ctx);
}

/** The current phase's timer has run out (and W1 says nobody is awaited any more): apply its normal outcome. */
function endPhase(ctx: Ctx) {
  const s = ctx.s;
  const p = s.phase;
  switch (p.type) {
    case "BRIEFING":
      return openRollCall(ctx);
    case "ROLL_CALL": {
      const present = presentSeats(s).length;
      const required = debateQuorumRequired(Object.keys(s.seats).length);
      if (present >= required) {
        record(ctx, { source: "chair", substantive: false, text: `Roll call closed: ${present} present (debate quorum ${required}).` });
        return nextSpeakerOrFloor(ctx, "empty_list");
      }
      if (sessionOver(ctx)) return sessionEnd(ctx);
      announce(ctx, `No debate quorum yet (${present}/${required}, rule 32). Roll call remains open.`);
      return transition(ctx, { type: "ROLL_CALL", deadlineMs: ctx.now + s.settings.timers.rollCallSec * 1000 });
    }
    case "SPEECH_PREP": {
      const st = s.seats[p.seat];
      if (!W(s) && (st.connection === "offline" || !isPresent(st))) {
        record(ctx, { source: "human_forfeit", seat: p.seat, substantive: false, text: `${st.countryName} was absent when recognised; time forfeited (rule 16).` });
        return endSpeechSlot(ctx, p.seat, p.context);
      }
      if (W(s)) {
        // W1 (reached only after the whole response window, connected or not): the speech was never started.
        record(ctx, { source: "human_forfeit", seat: p.seat, substantive: false, text: `${st.countryName} did not start the speech; the turn ended without a speech (no response).` });
        return endSpeechSlot(ctx, p.seat, p.context);
      }
      return beginHumanSpeech(ctx, p.seat, p.context);
    }
    case "SPEECH":
      if (p.speakerKind === "ai") {
        record(ctx, { source: "ai_speech", seat: p.seat, substantive: true, text: p.ai?.text ?? "" });
        return endSpeechSlot(ctx, p.seat, p.context);
      }
      return toConfirm(ctx, p.seat, p.context);
    case "AI_SPEECH_PENDING":
      record(ctx, { source: "ai_unavailable", seat: p.seat, substantive: false, text: `${s.seats[p.seat].countryName}: AI speech unavailable; turn skipped.` });
      return endSpeechSlot(ctx, p.seat, p.context);
    case "SPEECH_CONFIRM": {
      if (p.transcript.status === "ready" && p.transcript.text) {
        record(ctx, { source: "human_voice_auto", seat: p.seat, substantive: true, text: p.transcript.text });
        return endSpeechSlot(ctx, p.seat, p.context);
      }
      // App policy: one extension while the transcript is pending OR after it failed (time to type instead).
      if (!W(s) && (p.transcript.status === "pending" || p.transcript.status === "failed") && !p.waitExtended) {
        p.waitExtended = true;
        p.deadlineMs = ctx.now + s.settings.timers.transcriptConfirmSec * 1000;
        schedule(ctx, p.deadlineMs);
        return;
      }
      record(ctx, { source: "human_no_transcript", seat: p.seat, substantive: false, text: `${s.seats[p.seat].countryName} spoke; no transcript is available.` });
      return endSpeechSlot(ctx, p.seat, p.context);
    }
    case "FLOOR_OPEN":
      return closeFloor(ctx);
    case "VP_FLOOR":
      return closeVpFloor(ctx);
    case "DIVISION_PROPOSALS":
      return closeDivisionProposals(ctx);
    case "MOTION_VOTE": {
      const b = s.ballots[p.ballotId];
      if (p.stage === "reading") return openVoting(ctx, b, p);
      if (!W(s) && maybeNonResponseExtension(ctx, b, p)) return;
      return finishMotionVote(ctx);
    }
    case "VOTING_PROCEDURE": {
      if (p.stage === "between") return nextVotingItem(ctx, p.queue);
      const b = s.ballots[p.ballotId!];
      if (p.stage === "reading") return openVoting(ctx, b, p);
      if (!W(s) && maybeNonResponseExtension(ctx, b, p)) return;
      return finishSubstantiveVote(ctx);
    }
    case "MOD_CAUCUS": {
      if (p.volunteers.length === 0) return endCaucus(ctx); // rule 10: nobody wishes to speak → caucus ends
      const chosen = pickVolunteer(ctx, p.volunteers);
      return startSpeakerSlot(ctx, chosen, { kind: "mod_caucus" });
    }
    case "UNMOD_CAUCUS":
      return endCaucus(ctx);
    case "SUSPENDED":
      record(ctx, { source: "chair", substantive: false, text: "Meeting resumed after suspension." });
      return nextSpeakerOrFloor(ctx, "after_resume");
    case "DR_INTRO":
      if (p.stage === "presentation") {
        p.stage = "qa";
        p.deadlineMs = ctx.now + s.settings.timers.drQaSec * 1000;
        schedule(ctx, p.deadlineMs);
        return;
      }
      if (p.queue.length) {
        const [next, ...rest] = p.queue;
        return transition(ctx, { type: "DR_INTRO", queue: rest, docId: next, stage: "presentation", deadlineMs: ctx.now + s.settings.timers.drPresentationSec * 1000 });
      }
      return openFloor(ctx, "after_motions");
    case "AMENDMENT_SPONSOR_RESPONSE": {
      if (W(s) && p.wait && ctx.now >= p.wait.responseDeadlineMs) return resolveAmendmentResponse(ctx, "consent_not_obtained");
      if (s.settings.policies.amendmentSponsorSilence === "extend_once_then_not_agreeing" && !p.waitExtended) {
        p.waitExtended = true;
        p.deadlineMs = ctx.now + s.settings.timers.sponsorResponseSec * 1000;
        schedule(ctx, p.deadlineMs);
        return;
      }
      return resolveAmendmentResponse(ctx, "consent_not_obtained");
    }
    default:
      throw new Duplicate();
  }
}

/** Reading time is over: the ballot opens, AI votes are requested, and (W1) the response window starts. */
function openVoting(ctx: Ctx, b: Ballot, p: { stage: string; deadlineMs: number; wait?: ResponseWait }) {
  const s = ctx.s;
  b.status = "open";
  p.stage = "voting";
  p.deadlineMs = ctx.now + s.settings.timers.votingSec * 1000;
  if (W(s)) p.wait = newWait(ctx, p.deadlineMs);
  schedule(ctx, p.deadlineMs);
  const ai = Object.keys(b.eligible).filter((x) => s.seats[x].kind === "ai");
  if (ai.length) ctx.effects.push({ type: "ai_vote_needed", ballotId: b.id, seats: ai });
}

function beginHumanSpeech(ctx: Ctx, id: SeatId, context: SpeechContext) {
  const official = slotSeconds(ctx, context);
  // S1: humans may speak up to humanSpeechMaxSec on the speakers' list and in moderated caucuses (yielded time stays as yielded).
  const max = context.kind === "yield" ? official : Math.max(official, ctx.s.settings.timers.humanSpeechMaxSec ?? 0);
  transition(ctx, { type: "SPEECH", seat: id, speakerKind: "human", startedMs: ctx.now, deadlineMs: ctx.now + max * 1000, context, ...(max > official ? { officialSec: official } : {}) });
  ctx.effects.push({ type: "transcription_expected", seat: id, phaseId: ctx.s.phaseId });
}

function openRollCall(ctx: Ctx) {
  const s = ctx.s;
  transition(ctx, { type: "ROLL_CALL", deadlineMs: ctx.now + s.settings.timers.rollCallSec * 1000 });
  const ai = aiSeats(s, false);
  if (ai.length) ctx.effects.push({ type: "ai_attendance_needed", seats: ai });
}

/**
 * App policy H1 ("stop unnecessary work when every human has left"): a deadline that passes while no human
 * delegate is online does not advance the meeting. The forum holds (no AI calls, one scheduled check) and
 * resumes when a delegate reconnects; after settings.timers.idleHoldMaxSec it closes.
 */
function enterIdleHold(ctx: Ctx) {
  const s = ctx.s;
  const maxSec = s.settings.timers.idleHoldMaxSec ?? 600;
  s.paused = { pausedAtMs: ctx.now, remainingMs: 5000, autoResumeAtMs: ctx.now + maxSec * 1000, phaseDeadlineKey: s.phaseId, reason: "no_humans" };
  schedule(ctx, s.paused.autoResumeAtMs);
  record(ctx, {
    source: "chair",
    substantive: false,
    text: `No human delegate is online. The meeting is on hold (app policy H1); it resumes when a delegate reconnects and closes after ${Math.round(maxSec / 60)} min.`,
  });
}

function maybeNonResponseExtension(ctx: Ctx, b: Ballot, p: { deadlineMs: number }): boolean {
  const pol = b.kind === "procedural" ? ctx.s.settings.policies.proceduralNonResponse : ctx.s.settings.policies.substantiveNonResponse;
  if (pol !== "extend_once_then_record_not_voting" || b.extendedForNonResponse || pendingVoters(b).length === 0) return false;
  b.extendedForNonResponse = true;
  p.deadlineMs = ctx.now + ctx.s.settings.limits.nonResponseExtensionSec * 1000;
  schedule(ctx, p.deadlineMs);
  announce(ctx, `Voting extended once for delegations that have not voted.`);
  return true;
}

function toConfirm(ctx: Ctx, id: SeatId, context: SpeechContext, yieldTo?: { seat: SeatId; sec: number }) {
  transition(ctx, {
    type: "SPEECH_CONFIRM",
    seat: id,
    context,
    deadlineMs: ctx.now + ctx.s.settings.timers.transcriptConfirmSec * 1000,
    transcript: { status: "pending" },
    waitExtended: false,
    ...(yieldTo ? { yieldTo } : {}),
  });
}

function resolveAmendmentResponse(ctx: Ctx, outcome: "all_agreed" | "objected" | "consent_not_obtained") {
  const p = ctx.s.phase as Extract<Phase, { type: "AMENDMENT_SPONSOR_RESPONSE" }>;
  const a = ctx.s.amendments[p.amendmentId];
  const doc = ctx.s.documents[a.targetDocId];
  a.friendlyOutcome = outcome;
  if (outcome === "all_agreed") {
    doc.operative = applyAmendmentOp(doc, a.op);
    doc.version += 1;
    doc.textHash = docTextHash(doc);
    a.status = "friendly_adopted";
    record(ctx, { source: "chair", substantive: true, text: `Friendly amendment ${a.id} adopted into "${doc.title}" (now v${doc.version}).` });
  } else {
    a.status = "unfriendly_pending";
    const why =
      outcome === "objected"
        ? "a sponsor objected"
        : "not every sponsor consented in time (no objection was recorded; app policy D5)";
    record(ctx, { source: "chair", substantive: true, text: `Amendment ${a.id} is unfriendly because ${why}; it will be voted (2/3, rule 29) in voting procedure.` });
  }
  openFloor(ctx, "after_motions");
}

function pause(ctx: Ctx) {
  requireOwner(ctx);
  const s = ctx.s;
  if (s.paused) throw new Duplicate();
  const d = phaseDeadline(s.phase);
  if (d === null) reject("cannot_pause", "Nothing to pause in this phase");
  const left = s.settings.limits.pauseTotalMaxSec - s.usage.pauseUsedSec;
  if (left <= 0) reject("pause_limit", "Pause allowance for this forum is used up");
  const maxSec = Math.min(s.settings.limits.pauseMaxSec, left);
  s.paused = {
    pausedAtMs: ctx.now,
    remainingMs: Math.max(0, (d as number) - ctx.now),
    autoResumeAtMs: ctx.now + maxSec * 1000,
    phaseDeadlineKey: s.phaseId,
    reason: "owner",
  };
  schedule(ctx, s.paused.autoResumeAtMs);
  announce(ctx, "App paused by the room owner (not a formal suspension).");
}

function resume(ctx: Ctx, by: "owner" | "auto" | "reconnect") {
  const s = ctx.s;
  const pz = s.paused;
  if (!pz) throw new Duplicate();
  const elapsedMs = ctx.now - pz.pausedAtMs;
  if (pz.reason !== "no_humans") s.usage.pauseUsedSec += Math.ceil(elapsedMs / 1000);
  setPhaseDeadline(s.phase, ctx.now + pz.remainingMs);
  if (s.phase.type === "SPEECH" && s.phase.ai) s.phase.ai.playStartMs += elapsedMs;
  if (s.phase.type === "SPEECH") s.phase.startedMs += elapsedMs;
  const w = (s.phase as { wait?: ResponseWait }).wait;
  if (w) {
    // A pause never consumes anyone's response window (and a reconnect never resets it).
    w.requestedAtMs += elapsedMs;
    w.baseDeadlineMs += elapsedMs;
    w.responseDeadlineMs += elapsedMs;
  }
  s.paused = null;
  schedule(ctx, phaseDeadline(s.phase)!);
  announce(ctx, by === "auto" ? "App pause limit reached; resumed automatically." : by === "reconnect" ? "A delegate reconnected; the meeting continues." : "App resumed.");
}

function extend(ctx: Ctx, id: SeatId) {
  const st = requireSeatActor(ctx, id);
  if (st.kind !== "human") reject("humans_only", "Extensions exist to protect human participation time");
  const p = ctx.s.phase;
  const lim = ctx.s.settings.limits;
  if (W(ctx.s)) reject("not_needed", "Required responses are awaited for up to the response window (app policy W1); +30 s extensions are not used");
  const used = ctx.s.usage.extensionsBySeat[id] ?? 0;
  if (used >= lim.maxExtensionsPerSeat) reject("extension_limit", "Extension allowance used up");
  if (p.type === "FLOOR_OPEN") {
    if (p.extensionUsedSec + lim.extensionSec > lim.maxExtensionPerWindowSec) reject("window_extension_limit", "This window cannot be extended further");
    p.extensionUsedSec += lim.extensionSec;
    p.deadlineMs += lim.extensionSec * 1000;
  } else if ((p.type === "MOTION_VOTE" || p.type === "VOTING_PROCEDURE") && p.stage === "voting") {
    const b = ctx.s.ballots[p.ballotId!];
    if (b.extensionUsedSec + lim.extensionSec > lim.maxExtensionPerWindowSec) reject("window_extension_limit", "This vote cannot be extended further");
    b.extensionUsedSec += lim.extensionSec;
    p.deadlineMs += lim.extensionSec * 1000;
  } else reject("not_extendable", "Nothing to extend now");
  ctx.s.usage.extensionsBySeat[id] = used + 1;
  schedule(ctx, phaseDeadline(ctx.s.phase)!);
}

function dispatch(ctx: Ctx, c: Command) {
  const s = ctx.s;
  if (s.phase.type === "CLOSED" && c.type !== "connection") reject("closed", "Forum is closed");
  if (s.paused && !["app_resume", "connection", "tick"].includes(c.type)) reject("paused", "The app is paused");

  switch (c.type) {
    case "claim_seat": {
      // Lobby only. A human replaces the AI holding this country; one seat per user; no duplicates.
      if (ctx.actor.kind !== "human") reject("humans_only", "Only signed-in users claim seats");
      const uid = (ctx.actor as { uid: string }).uid;
      if (s.joinLocked || s.phase.type !== "LOBBY") reject("join_locked", "The forum has started; new participants cannot join");
      const st = seat(ctx, c.seat);
      if (st.kind === "human" && st.uid === uid) throw new Duplicate();
      if (st.kind === "human") reject("seat_taken", "Another delegate already represents this country");
      if (Object.values(s.seats).some((x) => x.uid === uid)) reject("already_seated", "You already represent a country in this forum");
      st.kind = "human";
      st.uid = uid;
      st.connection = "online";
      return;
    }
    case "release_seat": {
      const st = requireSeatActor(ctx, c.seat);
      if (s.joinLocked || s.phase.type !== "LOBBY") reject("join_locked", "Seats are fixed once the forum has started");
      if (st.uid === s.ownerUid) reject("owner_seat", "The room owner keeps a delegation");
      st.kind = "ai";
      delete st.uid;
      return;
    }
    case "start": {
      requireOwner(ctx);
      if (s.phase.type !== "LOBBY") throw new Duplicate();
      if (Object.keys(s.seats).length === 0) reject("no_seats", "No seats");
      s.joinLocked = true; // roster fixed atomically with the transition (rule: no new joiners after start)
      const briefingMs = (s.settings.timers.briefingSec ?? 0) * 1000;
      // The session clock starts when roll call opens (after the shared start briefing, if any).
      s.settings.sessionStartMs = ctx.now + briefingMs;
      s.settings.sessionEndsAtMs = s.settings.sessionStartMs + s.settings.sessionDurationSec * 1000;
      if (briefingMs > 0) return transition(ctx, { type: "BRIEFING", startedMs: ctx.now, deadlineMs: ctx.now + briefingMs });
      return openRollCall(ctx);
    }
    case "declare_attendance": {
      const st = requireSeatActor(ctx, c.seat);
      if (s.phase.type === "LOBBY" || s.phase.type === "BRIEFING") reject("not_started", "Roll call has not started");
      if (st.attendance === c.value) throw new Duplicate();
      if (st.attendance === "present_and_voting") reject("irrevocable", "Present and voting cannot be withdrawn (rule 31)");
      st.attendance = c.value;
      if (s.phase.type === "ROLL_CALL" && Object.values(s.seats).every(isPresent)) {
        const present = presentSeats(s).length;
        record(ctx, { source: "chair", substantive: false, text: `Roll call complete: ${present} present.` });
        return nextSpeakerOrFloor(ctx, "empty_list");
      }
      if (s.phase.type === "ROLL_CALL") return maybeAdvanceOnResponse(ctx);
      return;
    }
    case "add_to_speakers_list": {
      const st = requireSeatActor(ctx, c.seat);
      if (!isPresent(st)) reject("not_present", "Only present delegations may be added");
      if (s.debateClosed) reject("debate_closed", "Debate is closed");
      if (s.speakersList.includes(c.seat)) throw new Duplicate();
      s.speakersList.push(c.seat);
      return;
    }
    case "remove_from_speakers_list": {
      requireSeatActor(ctx, c.seat);
      const i = s.speakersList.indexOf(c.seat);
      if (i < 0) throw new Duplicate();
      s.speakersList.splice(i, 1);
      return;
    }
    case "start_speech": {
      const p = s.phase;
      if (p.type !== "SPEECH_PREP" || p.seat !== c.seat) reject("not_recognised", "You have not been given the floor", true);
      const st = requireSeatActor(ctx, c.seat);
      if (st.kind !== "human") reject("humans_only", "Only human speakers start their speech");
      return beginHumanSpeech(ctx, c.seat, (p as Extract<Phase, { type: "SPEECH_PREP" }>).context);
    }
    case "end_speech": {
      const p = s.phase;
      if (p.type !== "SPEECH" || p.seat !== c.seat || p.speakerKind !== "human") reject("not_speaking", "You do not hold the floor");
      requireSeatActor(ctx, c.seat);
      const sp = p as Extract<Phase, { type: "SPEECH" }>;
      let yieldTo: { seat: SeatId; sec: number } | undefined;
      if (c.yieldTo) {
        // Rule 18: yields only on speakers'-list speeches (not in moderated caucus); a yielded-to delegate may not yield again.
        if (sp.context.kind !== "speakers_list") reject("yield_not_in_order", "Yields are in order only on speakers' list speeches, and the receiver of a yield may not yield again (rule 18)");
        const to = seat(ctx, c.yieldTo);
        if (to.id === c.seat) reject("yield_self", "You cannot yield to yourself");
        if (!isPresent(to)) reject("not_present", "That delegation is not present");
        // Rule 18: the REMAINING OFFICIAL speaking time is yielded (not the extra S1 allowance).
        const officialEnd = sp.officialSec ? sp.startedMs + sp.officialSec * 1000 : sp.deadlineMs;
        const sec = Math.floor((officialEnd - ctx.now) / 1000);
        if (sec < 5) reject("no_time", "Less than 5 seconds remain; yield to the chair instead (app policy)");
        yieldTo = { seat: to.id, sec };
      }
      return toConfirm(ctx, c.seat, sp.context, yieldTo);
    }
    case "submit_text_speech": {
      requireSeatActor(ctx, c.seat);
      const p = s.phase;
      const text = c.text.trim();
      if (!text) reject("empty", "Text required");
      if ((p.type === "SPEECH" && p.speakerKind === "human" && p.seat === c.seat) || (p.type === "SPEECH_CONFIRM" && p.seat === c.seat)) {
        record(ctx, { source: "human_text", seat: c.seat, substantive: true, text });
        return endSpeechSlot(ctx, c.seat, p.context);
      }
      return reject("not_your_turn", "Text speeches replace your own speaking turn only");
    }
    case "transcript_result": {
      requireSystem(ctx);
      const p = s.phase;
      if (p.type !== "SPEECH_CONFIRM" || p.seat !== c.seat) reject("stale_transcript", "No confirmation pending for this seat", true);
      const pc = p as Extract<Phase, { type: "SPEECH_CONFIRM" }>;
      if (pc.transcript.status !== "pending") throw new Duplicate();
      pc.transcript = c.ok && c.text?.trim() ? { status: "ready", text: c.text.trim() } : { status: "failed" };
      return;
    }
    case "confirm_transcript": {
      requireSeatActor(ctx, c.seat);
      const p = s.phase;
      if (p.type !== "SPEECH_CONFIRM" || p.seat !== c.seat) reject("nothing_to_confirm", "No transcript awaiting your confirmation");
      const pc = p as Extract<Phase, { type: "SPEECH_CONFIRM" }>;
      const text = c.text.trim();
      if (!text) reject("empty", "Text required (use skip to continue without a transcript)");
      record(ctx, {
        source: pc.transcript.status === "ready" ? "human_voice_confirmed" : "human_text",
        seat: c.seat,
        substantive: true,
        text,
      });
      return endSpeechSlot(ctx, c.seat, pc.context);
    }
    case "skip_transcript": {
      requireSeatActor(ctx, c.seat);
      const p = s.phase;
      if (p.type !== "SPEECH_CONFIRM" || p.seat !== c.seat) reject("nothing_to_skip", "No transcript awaiting your confirmation");
      record(ctx, { source: "human_no_transcript", seat: c.seat, substantive: false, text: `${s.seats[c.seat].countryName} spoke; transcript skipped by the delegate.` });
      return endSpeechSlot(ctx, c.seat, (p as Extract<Phase, { type: "SPEECH_CONFIRM" }>).context);
    }
    case "ai_speech_ready": {
      const p = s.phase;
      if (ctx.actor.kind !== "system") requireSeatActor(ctx, c.seat);
      if (p.type === "SPEECH" && p.seat === c.seat && p.ai?.contextSeq === c.contextSeq) throw new Duplicate();
      if (p.type !== "AI_SPEECH_PENDING" || p.seat !== c.seat) reject("stale_phase", "This AI turn is no longer pending", true);
      const pp = p as Extract<Phase, { type: "AI_SPEECH_PENDING" }>;
      // A draft is usable only if it saw every confirmed statement so far (incl. the latest human speech).
      if (c.contextSeq !== s.contextSeq) reject("stale_context", `Draft built on context ${c.contextSeq}, current is ${s.contextSeq}`, true);
      const slotMs = slotSeconds(ctx, pp.context) * 1000;
      const estMs = c.durationMs ?? Math.ceil((c.text.split(/\s+/).length / 2.5) * 1000);
      const playStartMs = ctx.now + s.settings.timers.aiPlaybackLeadMs;
      transition(ctx, {
        type: "SPEECH",
        seat: c.seat,
        speakerKind: "ai",
        startedMs: playStartMs,
        deadlineMs: playStartMs + Math.min(estMs + 1000, slotMs),
        context: pp.context,
        ai: { text: c.text, audioId: c.audioId, playStartMs, durationMs: c.durationMs, contextSeq: c.contextSeq },
      });
      return;
    }
    case "submit_motion": {
      const st = requireSeatActor(ctx, c.seat);
      if (!isPresent(st)) reject("not_present", "Only present delegations may move motions");
      const p = s.phase;
      const v = validateMotion(s, c.seat, c.params, ctx.now);
      if (!v.ok) return reject(v.code, `${v.message} [${v.source}${v.ruleRef ? `, rule ${v.ruleRef}` : ""}]`);
      const fp = p as { windowId: string };
      const key = motionContentKey(c.seat, c.params);
      const inWindow = windowMotions(ctx, fp.windowId);
      if (c.params.type === "divide_question" && inWindow.some((m) => m.params.type === "divide_question" && m.mover !== c.seat)) {
        reject("already_on_floor", "A motion to divide this resolution is already on the floor (rule 33)");
      }
      const mine = inWindow.filter((m) => m.mover === c.seat);
      if (mine.some((m) => m.contentKey === key)) throw new Duplicate();
      if (mine.length >= s.settings.limits.maxMotionsPerSeatPerWindow) reject("motion_limit", "Motion limit for this window reached (app policy)");
      const id = newId(ctx, "m");
      s.motions[id] = { id, params: c.params, mover: c.seat, submittedAtMs: ctx.now, windowId: fp.windowId, contentKey: key, status: "pending" };
      if (W(s) && st.kind === "human" && s.standingNoMotion?.[c.seat]) delete s.standingNoMotion[c.seat]; // active again
      if (W(s) && st.kind === "human" && (p.type === "FLOOR_OPEN" || p.type === "VP_FLOOR")) {
        // W1: moving a motion is this delegate's response for the window (they may still add another while it is open).
        const rp = p as { readySeats: SeatId[] };
        if (!rp.readySeats.includes(c.seat)) rp.readySeats.push(c.seat);
        return maybeAdvanceOnResponse(ctx);
      }
      return; // legacy: submission never closes the window early
    }
    case "floor_pass": {
      const st = requireSeatActor(ctx, c.seat);
      const p = s.phase;
      if (p.type !== "FLOOR_OPEN" && p.type !== "VP_FLOOR" && p.type !== "DIVISION_PROPOSALS") reject("floor_not_open", "Floor is not open", true);
      const fp = p as { readySeats: SeatId[]; aiDoneSeats: SeatId[] };
      const list = st.kind === "ai" ? fp.aiDoneSeats : fp.readySeats;
      if (list.includes(c.seat)) throw new Duplicate();
      list.push(c.seat);
      if (W(s) && st.kind === "human" && p.type === "FLOOR_OPEN") (s.standingNoMotion ??= {})[c.seat] = floorContextKey(s);
      return W(s) ? maybeAdvanceOnResponse(ctx) : maybeCloseWindowEarly(ctx);
    }
    case "request_extension":
      return extend(ctx, c.seat);
    case "cast_vote": {
      requireSeatActor(ctx, c.seat);
      const b = s.ballots[c.ballotId];
      if (!b) reject("unknown_ballot", "Unknown ballot", true);
      const chk = checkVote(b, c.seat, c.choice);
      if (!chk.ok) {
        if (chk.code === "ballot_not_open" && b.status === "closed") reject(chk.code, chk.message, true);
        reject(chk.code, chk.message);
      }
      if (b.votes[c.seat] === c.choice) throw new Duplicate();
      b.votes[c.seat] = c.choice;
      const ph = s.phase as { ballotId?: string | null };
      if (W(s) && ph.ballotId === b.id) return maybeAdvanceOnResponse(ctx);
      if (allEligibleVoted(b)) {
        // Early close: every eligible voter (humans AND AI) has a valid vote.
        if (s.phase.type === "MOTION_VOTE" && s.phase.ballotId === b.id) return finishMotionVote(ctx);
        if (s.phase.type === "VOTING_PROCEDURE" && s.phase.ballotId === b.id) return finishSubstantiveVote(ctx);
      }
      return;
    }
    case "volunteer": {
      const st = requireSeatActor(ctx, c.seat);
      const p = s.phase;
      if (p.type !== "MOD_CAUCUS") reject("no_caucus", "No moderated caucus is taking volunteers", true);
      if (!isPresent(st)) reject("not_present", "Not present");
      const mp = p as Extract<Phase, { type: "MOD_CAUCUS" }>;
      if (mp.volunteers.includes(c.seat)) throw new Duplicate();
      mp.volunteers.push(c.seat);
      if (mp.passed?.includes(c.seat)) mp.passed = mp.passed.filter((x) => x !== c.seat);
      const ac = s.activeCaucus;
      if (ac?.passAll?.includes(c.seat)) ac.passAll = ac.passAll.filter((x) => x !== c.seat); // engaged again: asked every turn
      return maybeAdvanceOnResponse(ctx);
    }
    case "volunteer_pass": {
      requireSeatActor(ctx, c.seat);
      const p = s.phase;
      if (p.type !== "MOD_CAUCUS") reject("no_caucus", "No moderated caucus is taking volunteers", true);
      const mp = p as Extract<Phase, { type: "MOD_CAUCUS" }>;
      const ac = s.activeCaucus!;
      const scope = c.scope ?? "turn";
      if (scope === "resume") {
        if (!ac.passAll?.includes(c.seat)) throw new Duplicate();
        ac.passAll = ac.passAll.filter((x) => x !== c.seat);
        return; // asked again from this turn on (if they have not answered this turn, they are now awaited)
      }
      if (mp.volunteers.includes(c.seat)) reject("already_volunteered", "You already volunteered in this turn");
      if (scope === "caucus") {
        ac.passAll ??= [];
        if (ac.passAll.includes(c.seat)) throw new Duplicate();
        ac.passAll.push(c.seat); // ends with this caucus; volunteering in any turn cancels it
        return maybeAdvanceOnResponse(ctx);
      }
      mp.passed ??= [];
      if (mp.passed.includes(c.seat)) throw new Duplicate();
      mp.passed.push(c.seat);
      return maybeAdvanceOnResponse(ctx);
    }
    case "caucus_ready": {
      const st = requireSeatActor(ctx, c.seat);
      const p = s.phase;
      if (p.type !== "UNMOD_CAUCUS") reject("no_caucus", "No unmoderated caucus", true);
      const up = p as Extract<Phase, { type: "UNMOD_CAUCUS" }>;
      if (up.readySeats.includes(c.seat)) throw new Duplicate();
      up.readySeats.push(c.seat);
      if (st.kind === "human") maybeEndUnmodEarly(ctx);
      return;
    }
    case "submit_document": {
      requireSeatActor(ctx, c.seat);
      if (s.phase.type === "LOBBY") reject("not_started", "Not started");
      if (s.debateClosed) reject("debate_closed", "Debate is closed");
      const id = newId(ctx, "d");
      const doc = {
        id,
        kind: c.kind,
        title: c.title.trim() || "Untitled",
        sponsors: [c.seat],
        signatories: [],
        preambular: c.preambular,
        operative: c.operative,
        version: 1,
        textHash: "",
        status: "draft" as const,
        submittedBy: c.seat,
        submittedAtMs: ctx.now,
      };
      doc.textHash = docTextHash(doc);
      s.documents[id] = doc;
      requestCaucusWork(ctx, id, c.seat);
      return reapprove(ctx, id);
    }
    case "update_document": {
      requireSeatActor(ctx, c.seat);
      const d = s.documents[c.docId];
      if (!d) reject("unknown_doc", "Unknown document");
      if (!d.sponsors.includes(c.seat)) reject("sponsors_only", "Only sponsors may edit");
      if (d.status !== "draft" && d.status !== "approved") reject("locked", "Introduced text changes only through amendments (rule 29)");
      const hash = docTextHash({ title: d.title, preambular: c.preambular, operative: c.operative });
      if (hash === d.textHash) throw new Duplicate();
      d.preambular = c.preambular;
      d.operative = c.operative;
      d.version += 1;
      d.textHash = hash;
      d.status = "draft";
      return reapprove(ctx, d.id);
    }
    case "sign_document": {
      requireSeatActor(ctx, c.seat);
      const d = s.documents[c.docId];
      if (!d) reject("unknown_doc", "Unknown document");
      if (d.status !== "draft" && d.status !== "approved") reject("locked", "Document already introduced");
      const list = c.role === "sponsor" ? d.sponsors : d.signatories;
      const other = c.role === "sponsor" ? d.signatories : d.sponsors;
      if (list.includes(c.seat)) throw new Duplicate();
      const oi = other.indexOf(c.seat);
      if (oi >= 0) other.splice(oi, 1);
      list.push(c.seat);
      return reapprove(ctx, d.id);
    }
    case "submit_amendment": {
      requireSeatActor(ctx, c.seat);
      if (s.debateClosed) reject("debate_closed", "Debate is closed");
      const d = s.documents[c.targetDocId];
      if (!d || d.status !== "introduced") reject("target_not_introduced", "Amendments apply to introduced resolutions (rule 29)");
      const err = validateAmendmentOp(d, c.op);
      if (err) reject("bad_amendment", err);
      const id = newId(ctx, "a");
      s.amendments[id] = {
        id,
        targetDocId: d.id,
        targetVersion: d.version,
        op: c.op,
        proposer: c.seat,
        signatories: [],
        textHash: stableHash({ t: d.id, v: d.version, op: c.op }),
        status: "draft",
      };
      requestCaucusWork(ctx, id, c.seat);
      return;
    }
    case "sign_amendment": {
      requireSeatActor(ctx, c.seat);
      const a = s.amendments[c.amendmentId];
      if (!a || a.status !== "draft") reject("unknown_amendment", "Amendment not open for signatures");
      if (a.signatories.includes(c.seat) || a.proposer === c.seat) throw new Duplicate();
      a.signatories.push(c.seat);
      return;
    }
    case "sponsor_response": {
      requireSeatActor(ctx, c.seat);
      const p = s.phase;
      if (p.type !== "AMENDMENT_SPONSOR_RESPONSE" || p.amendmentId !== c.amendmentId) reject("no_request", "No sponsor response pending", true);
      const pp = p as Extract<Phase, { type: "AMENDMENT_SPONSOR_RESPONSE" }>;
      const doc = s.documents[s.amendments[pp.amendmentId].targetDocId];
      if (!doc.sponsors.includes(c.seat)) reject("sponsors_only", "Only sponsors of the resolution respond");
      if (pp.responses[c.seat]) throw new Duplicate();
      pp.responses[c.seat] = c.agree ? "agree" : "disagree";
      if (!c.agree) return resolveAmendmentResponse(ctx, "objected"); // rule 29: any sponsor disagreeing → unfriendly
      if (doc.sponsors.every((sp) => pp.responses[sp] === "agree")) return resolveAmendmentResponse(ctx, "all_agreed");
      return;
    }
    case "submit_division_proposal": {
      const st = requireSeatActor(ctx, c.seat);
      if (!isPresent(st)) reject("not_present", "Only present delegations may propose a division");
      const p = s.phase;
      if (p.type !== "DIVISION_PROPOSALS" || p.docId !== c.docId) reject("not_accepting", "Division proposals are not being accepted for this resolution", true);
      const { divisions, proposals } = divisionsOf(s);
      const div = divisions[c.docId];
      const n = normaliseDivision(div.baseOperative.length, c.parts);
      if (!n.ok) return reject("bad_division", `${n.error} [official, rule 33]`);
      const parts = n.parts.map((clauses) => ({ clauses }));
      const key = JSON.stringify(parts);
      const mine = div.proposals.map((id) => proposals[id]).filter((x) => x.proposer === c.seat);
      if (mine.some((x) => JSON.stringify(x.parts) === key)) throw new Duplicate();
      if (mine.length >= s.settings.limits.maxMotionsPerSeatPerWindow) reject("proposal_limit", "Proposal limit for this resolution reached (app policy)");
      const id = newId(ctx, "dv");
      proposals[id] = { id, docId: c.docId, proposer: c.seat, parts, submittedAtMs: ctx.now, status: "pending" };
      div.proposals.push(id);
      if (W(s) && st.kind === "human") {
        const dp = p as Extract<Phase, { type: "DIVISION_PROPOSALS" }>;
        if (!dp.readySeats.includes(c.seat)) dp.readySeats.push(c.seat);
        return maybeAdvanceOnResponse(ctx);
      }
      return;
    }
    case "raise_point": {
      // Rule 20 (adapted): a point of personal privilege reports a problem affecting participation (audio, connection).
      requireSeatActor(ctx, c.seat);
      if (s.phase.type === "LOBBY") reject("not_started", "Not started");
      const text = c.text.trim().slice(0, 200);
      if (!text) reject("empty", "Describe the problem");
      record(ctx, { source: "chair", seat: c.seat, substantive: false, text: `Point of personal privilege (rule 20) — ${s.seats[c.seat].countryName}: ${text}` });
      return;
    }
    case "app_pause":
      return pause(ctx);
    case "app_resume":
      requireOwner(ctx);
      return resume(ctx, "owner");
    case "connection": {
      requireSystem(ctx);
      const st = seat(ctx, c.seat);
      const v = c.online ? "online" : "offline";
      if (st.connection === v) throw new Duplicate();
      st.connection = v; // never changes an open ballot's electorate
      if (c.online && st.kind === "human" && s.paused?.reason === "no_humans") return resume(ctx, "reconnect");
      if (W(s)) {
        // W1: connection changes never shorten or reset anyone's response window (the deadline is fixed server time).
        if (!c.online && s.phase.type === "UNMOD_CAUCUS") return maybeEndUnmodEarly(ctx);
        return;
      }
      // A delegate leaving may mean every REMAINING online delegate is already ready (app policy).
      if (!c.online && ["FLOOR_OPEN", "VP_FLOOR", "DIVISION_PROPOSALS"].includes(s.phase.type)) return maybeCloseWindowEarly(ctx);
      if (!c.online && s.phase.type === "UNMOD_CAUCUS") return maybeEndUnmodEarly(ctx);
      return;
    }
    case "tick":
      requireSystem(ctx);
      return handleTick(ctx);
  }
}

/** A new draft or amendment during an unmoderated caucus: the other AI delegations may sign or sponsor it. */
function requestCaucusWork(ctx: Ctx, trigger: string, by: SeatId) {
  if (ctx.s.phase.type !== "UNMOD_CAUCUS") return;
  const ai = aiSeats(ctx.s).filter((x) => x !== by);
  if (ai.length) ctx.effects.push({ type: "ai_caucus_work_needed", phaseId: ctx.s.phaseId, seats: ai, trigger });
}

function reapprove(ctx: Ctx, docId: string) {
  const d = ctx.s.documents[docId];
  if (d.kind !== "draft_resolution" || (d.status !== "draft" && d.status !== "approved")) return;
  const r = evaluateApproval(ctx.s, d);
  d.status = r.approved ? "approved" : "draft";
}

function checkExpectation(s: ForumEngineState, env: CommandEnvelope) {
  const e = env.expect;
  if (!e) return;
  if (e.phaseId !== undefined && e.phaseId !== s.phaseId) reject("stale_phase", `Expected phase ${e.phaseId}, now ${s.phaseId}`, true);
  if (e.ballotId !== undefined) {
    const b = s.ballots[e.ballotId];
    if (!b || (b.status !== "open" && b.status !== "reading")) reject("stale_ballot", "Ballot no longer open", true);
    if (e.textHash !== undefined && "textHash" in b.subject && b.subject.textHash !== e.textHash) {
      reject("stale_text", "Text under vote differs from the one evaluated", true);
    }
  }
  if (e.contextSeq !== undefined && e.contextSeq !== s.contextSeq) {
    reject("stale_context", `Context moved from ${e.contextSeq} to ${s.contextSeq}`, true);
  }
}

export function apply(state: ForumEngineState, env: CommandEnvelope, nowMs: number): ApplyResult {
  const s = structuredClone(state);
  const ctx: Ctx = { s, now: nowMs, actor: env.actor, effects: [], notes: [] };
  try {
    checkExpectation(s, env);
    dispatch(ctx, env.command);
  } catch (e) {
    if (e instanceof Duplicate) return { ok: true, state, effects: [], events: [], duplicate: true };
    if (e instanceof Reject) return { ok: false, code: e.code, message: e.message, stale: e.stale };
    throw e;
  }
  s.eventSeq += 1;
  const event: EngineEvent = {
    seq: s.eventSeq,
    atMs: nowMs,
    actor: env.actor,
    command: env.command.type,
    summary: ctx.notes.join(" "),
  };
  return { ok: true, state: s, effects: ctx.effects, events: [event] };
}

/** Utility for UIs: what can this seat do right now (names only; validation still happens on submit). */
export function availableActions(s: ForumEngineState, seatId: SeatId): Command["type"][] {
  const p = s.phase;
  const st = s.seats[seatId];
  if (!st || p.type === "CLOSED" || s.paused) return [];
  const out: Command["type"][] = [];
  if (p.type !== "LOBBY" && st.attendance !== "present_and_voting") out.push("declare_attendance");
  if (!isPresent(st)) return p.type !== "LOBBY" ? [...out, "raise_point"] : out;
  if (!s.debateClosed && !s.speakersList.includes(seatId)) out.push("add_to_speakers_list");
  const ext = W(s) ? [] : (["request_extension"] as const);
  if (p.type === "FLOOR_OPEN") out.push("submit_motion", "floor_pass", ...ext);
  if (p.type === "VP_FLOOR") out.push("submit_motion", "floor_pass");
  if (p.type === "DIVISION_PROPOSALS") out.push("submit_division_proposal", "floor_pass");
  if (p.type !== "LOBBY") out.push("raise_point");
  if ((p.type === "MOTION_VOTE" || p.type === "VOTING_PROCEDURE") && p.stage === "voting" && p.ballotId) {
    const b = s.ballots[p.ballotId];
    if (b.eligible[seatId] && !b.votes[seatId]) out.push("cast_vote", ...ext);
  }
  if (p.type === "SPEECH_PREP" && p.seat === seatId) out.push("start_speech");
  if (p.type === "SPEECH" && p.seat === seatId && p.speakerKind === "human") out.push("end_speech", "submit_text_speech");
  if (p.type === "SPEECH_CONFIRM" && p.seat === seatId) out.push("confirm_transcript", "submit_text_speech", "skip_transcript");
  if (p.type === "MOD_CAUCUS") out.push("volunteer", "volunteer_pass");
  if (p.type === "UNMOD_CAUCUS") out.push("caucus_ready", "submit_document", "sign_document");
  return out;
}
