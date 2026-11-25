/**
 * OPEN DECISIONS — behaviour the HMUN text does not settle for an online meeting.
 * The product owner has not approved any option yet, so the engine has NO default:
 * every forum must carry an explicit choice for each key (validated by assertPoliciesComplete).
 * Tests exercise every option.
 */

export type NonResponsePolicy =
  /** Eligible roster fixed at ballot open. Non-voters are recorded as "did not vote" (not abstain).
   *  Pass/fail uses rule 35's formula (Yes vs No only), so non-voters affect neither side. */
  | "record_not_voting"
  /** As above, but the voting window is extended once (by settings.limits.nonResponseExtensionSec)
   *  if any eligible voter has not voted when it closes. */
  | "extend_once_then_record_not_voting"
  /** Stricter online variant: a motion passes only if Yes exceeds half (or 2/3) of the fixed eligible roster.
   *  Deviates from rule 35's formula; listed for comparison. */
  | "require_majority_of_eligible";

export type CarryOverPolicy =
  /** Motions that neither conflict with nor are made obsolete by the adopted motion stay pending
   *  and are voted first in the next floor window. */
  | "carry_over_to_next_window"
  /** They lapse; delegates may resubmit them in the next floor window. */
  | "lapse";

export type OpenPolicies = {
  proceduralNonResponse: NonResponsePolicy;
  substantiveNonResponse: NonResponsePolicy;
  /** What happens to remaining, non-conflicting motions once an adopted motion changes the meeting mode. */
  remainingMotionsAfterModeChange: CarryOverPolicy;
  /** Rule 13 says "if the committee is in favor" without a threshold. */
  enterVotingThreshold: "simple_majority" | "two_thirds";
  /** Rule 29: friendly only if EACH sponsor agrees. Silence is not addressed. */
  amendmentSponsorSilence: "treated_as_not_agreeing" | "extend_once_then_not_agreeing";
  /** When session time runs out. */
  sessionEnd: "close_forum" | "enter_voting_if_resolutions_introduced";
  /** Rule 32 requires a voting quorum; the consequence of a missing quorum for a pending motion is not stated. */
  noVotingQuorum: "motion_not_adopted" | "motion_carried_to_next_window";
};

export const OPEN_POLICY_OPTIONS: { [K in keyof OpenPolicies]: readonly OpenPolicies[K][] } = {
  proceduralNonResponse: ["record_not_voting", "extend_once_then_record_not_voting", "require_majority_of_eligible"],
  substantiveNonResponse: ["record_not_voting", "extend_once_then_record_not_voting", "require_majority_of_eligible"],
  remainingMotionsAfterModeChange: ["carry_over_to_next_window", "lapse"],
  enterVotingThreshold: ["simple_majority", "two_thirds"],
  amendmentSponsorSilence: ["treated_as_not_agreeing", "extend_once_then_not_agreeing"],
  sessionEnd: ["close_forum", "enter_voting_if_resolutions_introduced"],
  noVotingQuorum: ["motion_not_adopted", "motion_carried_to_next_window"],
};

export function assertPoliciesComplete(p: Partial<OpenPolicies> | undefined): asserts p is OpenPolicies {
  const missing = (Object.keys(OPEN_POLICY_OPTIONS) as Array<keyof OpenPolicies>).filter(
    (k) => !p || !(OPEN_POLICY_OPTIONS[k] as readonly string[]).includes(p[k] as string),
  );
  if (missing.length) {
    throw new Error(`Open rule decisions not set for this forum: ${missing.join(", ")}`);
  }
}
