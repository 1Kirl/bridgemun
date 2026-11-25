/**
 * Rule catalogue: HMUN 2026 Conference Handbook, "Rules of Procedure" (pp. 24–29).
 * Source PDF: https://static1.squarespace.com/static/5c74d134da50d3186dc8d782/t/69752a454f7e2f309939c03e/1769286213867/HMUN%2B2026%2BConference%2BHandbook.pdf
 *
 * Scope clarification:
 *  - Rules 1–36 are the general rules (GA, ECOSOC, Regional Bodies — rule 1). These are the basis.
 *  - Rules 37–40 govern Specialized Bodies / Crisis Committees (directives, round robins, crisis notes)
 *    and are EXCLUDED.
 *
 * Every behaviour in the engine is tagged with one of these sources:
 *  - "official"            text of the rule applied directly
 *  - "rule_interpretation" the rule is silent/ambiguous; our reading is documented
 *  - "app_policy"          online/learning adaptation (timers, caps, automation) — NOT an MUN rule
 *  - "open_decision"       not yet decided by the product owner; engine requires an explicit setting
 */

export const RULESET_ID = "hmun-ga-2026@1" as const;

export type RuleSource = "official" | "rule_interpretation" | "app_policy" | "open_decision";

export type RuleStatus = "applied" | "applied_adapted" | "partial" | "planned" | "excluded";

export type RuleEntry = {
  rule: number;
  title: string;
  status: RuleStatus;
  note: string;
};

export const HMUN_RULES: RuleEntry[] = [
  { rule: 1, title: "Scope", status: "applied", note: "GA-type committees only (DISEC, SOCHUM, WHO-as-HMUN, ECOFIN, SPECPOL)." },
  { rule: 2, title: "Language", status: "applied", note: "English is the working language; AI speaks English; humans should speak English for transcription." },
  { rule: 3, title: "Delegations", status: "applied_adapted", note: "One seat = one vote. One human per seat (co-delegates not supported yet)." },
  { rule: 4, title: "Participation of Non-Members", status: "excluded", note: "No guest speakers." },
  { rule: 5, title: "Credentials", status: "applied_adapted", note: "Replaced by join code + server seat assignment." },
  { rule: 6, title: "General Powers of the Committee Staff", status: "applied_adapted", note: "Director/Moderator discretion replaced by the server engine with fixed, published parameters. No human chair." },
  { rule: 7, title: "Courtesy", status: "excluded", note: "Not automated (no moderation feature in scope)." },
  { rule: 8, title: "Electronic Devices", status: "excluded", note: "Not applicable online." },
  { rule: 9, title: "Debate", status: "applied", note: "One continuously open speakers list for the topic." },
  { rule: 10, title: "Moderated Caucuses", status: "applied_adapted", note: "Topic, speaking time, total time; each speech counts the full speaking time; ends when nobody volunteers; no yields/motions inside." },
  { rule: 11, title: "Unmoderated Caucuses", status: "applied_adapted", note: "Formal debate suspended; free audio + shared documents. Early end replaces moderator discretion with an all-humans-ready rule (app policy)." },
  { rule: 12, title: "Extensions", status: "applied", note: "Extension ≤ half of the original caucus length." },
  { rule: 13, title: "Voting Procedure", status: "applied_adapted", note: "Vote threshold not stated in the rule → open decision." },
  { rule: 14, title: "Suspension or Adjournment of the Meeting", status: "applied_adapted", note: "Suspension = timed pause (online adaptation). Adjournment ends the forum." },
  { rule: 15, title: "Speakers' List", status: "applied", note: "If all motions fail, return to the speakers list." },
  { rule: 16, title: "Speeches", status: "applied", note: "Absent when recognised → time forfeited, debate continues." },
  { rule: 17, title: "Speaking Time", status: "applied", note: "Default 60 seconds; motion to change speaking time." },
  { rule: 18, title: "Yields", status: "partial", note: "Yield to the chair (default) and to another delegate (remaining time; receiver cannot yield again; speakers' list speeches only). Yield to questions: not implemented (questioner selection is moderator discretion)." },
  { rule: 19, title: "Right of Reply", status: "excluded", note: "Depends on moderator judgement of impugned integrity; not automated." },
  { rule: 20, title: "Points of Personal Privilege", status: "applied_adapted", note: "Recorded notice to the room (audio/connection problems); the owner may pause the app." },
  { rule: 21, title: "Points of Order", status: "applied_adapted", note: "Every action is checked by the engine; out-of-order actions are refused with the rule cited. Rule 21's 'final discretion' clause is not used." },
  { rule: 22, title: "Points of Parliamentary Inquiry", status: "applied_adapted", note: "Answered in the room from the current phase description and this catalogue." },
  { rule: 23, title: "Points of Information", status: "applied", note: "Not recognised (as in HMUN)." },
  { rule: 24, title: "Sponsors and Signatories", status: "applied_adapted", note: "Minimums set by forum settings (Director role)." },
  { rule: 25, title: "Working Papers", status: "applied_adapted", note: "Shared during unmoderated caucus; limits from settings." },
  { rule: 26, title: "Resolutions", status: "applied_adapted", note: "'Director approval' replaced by automatic checks (app policy). Simple majority. Several may pass; latest prevails on contradiction." },
  { rule: 27, title: "Introducing Resolutions", status: "applied_adapted", note: "Motion introduces approved resolutions in submission order." },
  { rule: 28, title: "Authors' Panel", status: "partial", note: "Presentation + Q&A windows; details in Phase 6." },
  { rule: 29, title: "Amendments", status: "applied", note: "Motion to introduce (procedural, simple majority); friendly if all sponsors agree; otherwise 2/3 substantive. No amendments to amendments." },
  { rule: 30, title: "Procedural and Substantive Votes", status: "applied", note: "Procedural: Yes/No only. Substantive: abstention allowed (subject to rule 31)." },
  { rule: 31, title: "Attendance", status: "applied", note: "Present / present and voting; the latter cannot abstain on substantive votes." },
  { rule: 32, title: "Quorum", status: "applied", note: "Debate: ≥ 1/4 of members present. Voting: simple majority of members present." },
  { rule: 33, title: "Division of the Question", status: "applied", note: "Motion (procedural, simple majority) → proposals → most to least disruptive (more parts first, interpretation) → parts voted for inclusion → recombined; all parts rejected → rejected as a whole. Resolutions only." },
  { rule: 34, title: "Reordering Resolutions", status: "applied", note: "Taken before the first resolution vote; proposals voted in order received (simple majority); first passing proposal wins." },
  { rule: 35, title: "Voting", status: "applied_adapted", note: "One vote per country; placards → buttons; simple majority = more Yes than No; 2/3 = Yes ≥ 2×No. Roll call votes not supported." },
  { rule: 36, title: "Disruptiveness (precedence)", status: "applied_adapted", note: "Order applied. 'Suspension of the Rules of Parliamentary Procedure' is excluded." },
  { rule: 37, title: "Directives", status: "excluded", note: "Specialized/Crisis only." },
  { rule: 38, title: "Introducing Directives", status: "excluded", note: "Specialized/Crisis only." },
  { rule: 39, title: "Round Robins", status: "excluded", note: "Specialized/Crisis only." },
  { rule: 40, title: "Crisis Notes", status: "excluded", note: "Crisis only." },
];

export const DEFAULT_SPEAKING_TIME_SEC = 60; // rule 17 (official)
