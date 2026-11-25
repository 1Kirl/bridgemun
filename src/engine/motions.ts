import type { RuleSource } from "@/engine/ruleset/hmun-ga-2026";
import { effectiveDocThresholds } from "@/engine/documents";
import type { ForumEngineState, Motion, MotionParams, MotionType, Threshold } from "@/engine/types";

export type MotionSpec = {
  type: MotionType;
  ruleRefs: string;
  /** Rule 36 order; lower = more disruptive = voted first. */
  precedence: number;
  /** Rule 36 groups 2 & 3 are "procedural motions that are not debatable". No seconds exist in HMUN. */
  debatable: false;
  secondRequired: false;
  context: "debate" | "voting_procedure";
  implemented: boolean;
};

export const MOTION_SPECS: Record<MotionType, MotionSpec> = {
  adjourn: { type: "adjourn", ruleRefs: "14, 36.2b", precedence: 1, debatable: false, secondRequired: false, context: "debate", implemented: true },
  suspend: { type: "suspend", ruleRefs: "14, 36.2c", precedence: 2, debatable: false, secondRequired: false, context: "debate", implemented: true },
  extend_caucus: { type: "extend_caucus", ruleRefs: "12, 36.2d", precedence: 3, debatable: false, secondRequired: false, context: "debate", implemented: true },
  unmod_caucus: { type: "unmod_caucus", ruleRefs: "11, 36.2e", precedence: 4, debatable: false, secondRequired: false, context: "debate", implemented: true },
  mod_caucus: { type: "mod_caucus", ruleRefs: "10, 36.2f", precedence: 5, debatable: false, secondRequired: false, context: "debate", implemented: true },
  set_speaking_time: { type: "set_speaking_time", ruleRefs: "17, 36.2g", precedence: 6, debatable: false, secondRequired: false, context: "debate", implemented: true },
  introduce_resolution: { type: "introduce_resolution", ruleRefs: "26–27, 36.2h", precedence: 7, debatable: false, secondRequired: false, context: "debate", implemented: true },
  introduce_amendment: { type: "introduce_amendment", ruleRefs: "29, 36.2i", precedence: 8, debatable: false, secondRequired: false, context: "debate", implemented: true },
  enter_voting: { type: "enter_voting", ruleRefs: "13, 36.3a", precedence: 9, debatable: false, secondRequired: false, context: "debate", implemented: true },
  reorder_resolutions: { type: "reorder_resolutions", ruleRefs: "34, 36.3b", precedence: 10, debatable: false, secondRequired: false, context: "voting_procedure", implemented: false },
  divide_question: { type: "divide_question", ruleRefs: "33, 36.3c", precedence: 11, debatable: false, secondRequired: false, context: "voting_procedure", implemented: false },
};

export function motionThreshold(type: MotionType, state: ForumEngineState): Threshold {
  if (type === "enter_voting") {
    // Rule 13 silent on threshold → open decision.
    return state.settings.policies.enterVotingThreshold;
  }
  return "simple_majority"; // rules 10–14, 17, 27, 29 (official)
}

export function motionContentKey(seat: string, p: MotionParams): string {
  return `${seat}|${JSON.stringify(p)}`;
}

export type Validation =
  | { ok: true }
  | { ok: false; code: string; message: string; source: RuleSource; ruleRef?: string };

const bad = (code: string, message: string, source: RuleSource, ruleRef?: string): Validation => ({
  ok: false,
  code,
  message,
  source,
  ruleRef,
});

function remainingSessionSec(state: ForumEngineState, nowMs: number) {
  return Math.max(0, Math.floor((state.settings.sessionEndsAtMs - nowMs) / 1000));
}

/** Same function for human and AI motions. Only checks; never mutates. */
export function validateMotion(state: ForumEngineState, seat: string, p: MotionParams, nowMs: number): Validation {
  const spec = MOTION_SPECS[p.type];
  const d = state.settings.dilatory;
  if (!spec.implemented) {
    return bad("not_supported_yet", `${p.type} is specified but not implemented until Phase 6`, "app_policy", spec.ruleRefs);
  }
  if (state.phase.type !== "FLOOR_OPEN") {
    return bad("floor_not_open", "Motions are in order only when the floor is open", "official", "10–14, 17");
  }
  if (state.debateClosed && spec.context === "debate") {
    return bad("debate_closed", "Debate is closed", "official", "10, 11, 12, 13");
  }
  const remaining = remainingSessionSec(state, nowMs);
  switch (p.type) {
    case "adjourn":
      if (remaining > d.adjournMaxRemainingRatio * ((state.settings.sessionEndsAtMs - state.settings.sessionStartMs) / 1000)) {
        return bad("dilatory", "Too much session time remains to adjourn", "app_policy", "14");
      }
      return { ok: true };
    case "suspend":
      if (p.durationSec < d.suspendMinSec || p.durationSec > d.suspendMaxSec) {
        return bad("dilatory", `Suspension must be ${d.suspendMinSec}–${d.suspendMaxSec}s online`, "app_policy", "14");
      }
      return { ok: true };
    case "extend_caucus": {
      const last = state.lastEndedCaucus;
      const fl = state.phase;
      if (!last || fl.origin !== "after_caucus") {
        return bad("no_caucus_to_extend", "An extension must follow a caucus that just ended", "rule_interpretation", "12");
      }
      if (last.isExtension) return bad("dilatory", "A caucus can be extended only once", "app_policy", "12");
      if (p.durationSec <= 0 || p.durationSec * 2 > last.totalSec) {
        return bad("too_long", "Extension may not exceed half the original caucus length", "official", "12");
      }
      if (p.durationSec > remaining) return bad("dilatory", "Exceeds remaining session time", "app_policy", "12");
      return { ok: true };
    }
    case "unmod_caucus":
      if (p.totalSec < d.unmodMinSec || p.totalSec > d.unmodMaxSec) {
        return bad("dilatory", `Unmoderated caucus must be ${d.unmodMinSec}–${d.unmodMaxSec}s`, "app_policy", "11");
      }
      if (p.totalSec > remaining) return bad("dilatory", "Exceeds remaining session time", "app_policy", "11");
      return { ok: true };
    case "mod_caucus":
      if (!p.topic || !p.topic.trim()) return bad("missing_topic", "A moderated caucus must specify a topic", "official", "10");
      if (p.speakingSec < d.modSpeakingMinSec || p.speakingSec > d.modSpeakingMaxSec) {
        return bad("dilatory", `Speaking time must be ${d.modSpeakingMinSec}–${d.modSpeakingMaxSec}s`, "app_policy", "10");
      }
      if (p.totalSec < d.modTotalMinSec || p.totalSec > d.modTotalMaxSec) {
        return bad("dilatory", `Total time must be ${d.modTotalMinSec}–${d.modTotalMaxSec}s`, "app_policy", "10");
      }
      if (p.speakingSec > p.totalSec) return bad("invalid", "Speaking time exceeds total time", "rule_interpretation", "10");
      if (p.totalSec > remaining) return bad("dilatory", "Exceeds remaining session time", "app_policy", "10");
      return { ok: true };
    case "set_speaking_time":
      if (p.speakingSec < d.speakingTimeMinSec || p.speakingSec > d.speakingTimeMaxSec) {
        return bad("dilatory", `Speaking time must be ${d.speakingTimeMinSec}–${d.speakingTimeMaxSec}s`, "app_policy", "17");
      }
      if (p.speakingSec === state.speakingTimeSec) return bad("no_change", "Speaking time already set to that value", "app_policy", "17");
      return { ok: true };
    case "introduce_resolution": {
      const approved = Object.values(state.documents).filter((x) => x.kind === "draft_resolution" && x.status === "approved");
      if (approved.length === 0) return bad("nothing_to_introduce", "No approved draft resolution", "official", "26–27");
      return { ok: true };
    }
    case "introduce_amendment": {
      const a = state.amendments[p.amendmentId];
      if (!a || a.status !== "draft") return bad("no_amendment", "Amendment not found or already handled", "official", "29");
      const doc = state.documents[a.targetDocId];
      if (!doc || doc.status !== "introduced") {
        return bad("target_not_introduced", "Amendments apply only to introduced resolutions", "official", "29");
      }
      if (a.targetVersion !== doc.version) return bad("stale_amendment", "Resolution text changed since drafting", "app_policy", "29");
      if (a.signatories.length < effectiveDocThresholds(Object.keys(state.seats).length, state.settings.documents).amendmentSignatories) {
        return bad("signatories", "Not enough signatories for this amendment", "official", "29");
      }
      return { ok: true };
    }
    case "enter_voting": {
      if (state.introducedResolutionIds.length === 0) {
        return bad("dilatory", "No resolution has been introduced", "official", "13");
      }
      const pending = Object.values(state.documents).some((x) => x.kind === "draft_resolution" && x.status === "approved");
      if (pending) return bad("dilatory", "Approved resolutions have not been introduced yet", "rule_interpretation", "13");
      return { ok: true };
    }
    default:
      return bad("not_supported_yet", "Not implemented", "app_policy");
  }
}

/**
 * Voting order inside one floor window.
 * Across types: rule 36 (official). Same type: the rules are silent → documented app policy.
 */
export function compareMotions(a: Motion, b: Motion): number {
  const pa = MOTION_SPECS[a.params.type].precedence;
  const pb = MOTION_SPECS[b.params.type].precedence;
  if (pa !== pb) return pa - pb;
  const sameTypeKey = (m: Motion): number[] => {
    const p = m.params;
    if (p.type === "unmod_caucus") return [-p.totalSec];
    if (p.type === "mod_caucus") return [-p.totalSec, -p.speakingSec];
    if (p.type === "extend_caucus" || p.type === "suspend") return [-p.durationSec];
    return [];
  };
  const ka = sameTypeKey(a);
  const kb = sameTypeKey(b);
  for (let i = 0; i < Math.min(ka.length, kb.length); i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return a.submittedAtMs - b.submittedAtMs || a.id.localeCompare(b.id);
}

export const SAME_TYPE_ORDER_NOTE =
  "Same-type tie-break (app policy): caucuses by longer total time, then longer speaking time; " +
  "suspension/extension by longer duration; otherwise earliest submission.";

export type Disposition =
  | { kind: "continue_voting" }
  | { kind: "lapsed_conflict" }
  | { kind: "obsolete" }
  | { kind: "deferred" }; // resolved by open policy remainingMotionsAfterModeChange

export type DispositionRow = { disposition: Disposition["kind"]; source: RuleSource; rationale: string };

const CAUCUS: MotionType[] = ["unmod_caucus", "mod_caucus", "extend_caucus"];

/**
 * After `adopted` passes, what happens to `other` (a lower-ranked motion still queued in the same window)?
 * This table is the single source of truth and is exported for the report/UI.
 */
export function dispositionAfterAdoption(adopted: MotionType, other: MotionType): DispositionRow {
  if (adopted === "adjourn") {
    return { disposition: "obsolete", source: "official", rationale: "Rule 14: adjournment suspends all committee functions" };
  }
  if (adopted === "enter_voting") {
    return { disposition: "obsolete", source: "official", rationale: "Rule 13: debate is closed; debate motions are out of order" };
  }
  if (adopted === "suspend") {
    return { disposition: "deferred", source: "open_decision", rationale: "Rule 14 silent on pending motions across a suspension" };
  }
  if (CAUCUS.includes(adopted)) {
    if (other === "extend_caucus") {
      return { disposition: "obsolete", source: "rule_interpretation", rationale: "Rule 12: an extension refers to the caucus that just ended; a new caucus supersedes it" };
    }
    if (CAUCUS.includes(other)) {
      return { disposition: "lapsed_conflict", source: "rule_interpretation", rationale: "Rule 10: caucus motions are voted in order of disruptiveness; the committee can only enter one caucus" };
    }
    return { disposition: "deferred", source: "open_decision", rationale: "Not in conflict, but the meeting changes mode immediately" };
  }
  if (adopted === "set_speaking_time") {
    if (other === "set_speaking_time") {
      return { disposition: "lapsed_conflict", source: "app_policy", rationale: "Only one speaking time can apply; first adopted wins" };
    }
    return { disposition: "continue_voting", source: "rule_interpretation", rationale: "Rule 36: motions on the floor are considered in order; no mode change occurred" };
  }
  if (adopted === "introduce_resolution") {
    if (other === "introduce_resolution") {
      return { disposition: "lapsed_conflict", source: "rule_interpretation", rationale: "Rule 27: one motion introduces all approved resolutions" };
    }
    return { disposition: "deferred", source: "open_decision", rationale: "Authors' panel starts immediately" };
  }
  if (adopted === "introduce_amendment") {
    if (other === "introduce_amendment") {
      return { disposition: "deferred", source: "open_decision", rationale: "Sponsor response window starts immediately" };
    }
    return { disposition: "deferred", source: "open_decision", rationale: "Sponsor response window starts immediately" };
  }
  return { disposition: "continue_voting", source: "rule_interpretation", rationale: "Default: keep voting in rule 36 order" };
}
