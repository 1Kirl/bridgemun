import { RULESET_ID } from "@/engine/ruleset/hmun-ga-2026";

/**
 * Committees offered at forum creation. All GA-type committees share ONE engine (HMUN general rules);
 * they differ in mandate text, eligibility and agenda keywords only.
 *
 * `supportLevel` is honest status, shown in the UI:
 *  - "engine_tested": rules engine + state machine covered by automated tests; NOT yet verified end-to-end
 *  - "planned": not implemented — must not be offered as supported
 */
export type CommitteeId = "DISEC" | "SOCHUM" | "WHO_HMUN" | "ECOFIN" | "SPECPOL" | "UNSC";

export type Committee = {
  id: CommitteeId;
  name: string;
  body: string;
  mandate: string;
  eligibility: string;
  rulesetId: string | null;
  supportLevel: "engine_tested" | "planned";
  /** Lower-case keywords used only to SUGGEST a committee for an agenda; the user always chooses. */
  keywords: string[];
  disclaimer?: string;
};

export const COMMITTEES: Committee[] = [
  {
    id: "DISEC",
    name: "Disarmament and International Security Committee",
    body: "UN General Assembly — First Committee",
    mandate: "Disarmament, global challenges and threats to peace affecting the international community.",
    eligibility: "Any UN Member State (all Member States may be represented on GA Main Committees).",
    rulesetId: RULESET_ID,
    supportLevel: "engine_tested",
    keywords: ["disarm", "weapon", "nuclear", "missile", "cyber", "security", "arms", "military", "drone", "terror"],
  },
  {
    id: "SOCHUM",
    name: "Social, Humanitarian and Cultural Committee",
    body: "UN General Assembly — Third Committee",
    mandate: "Social, humanitarian and human-rights questions.",
    eligibility: "Any UN Member State.",
    rulesetId: RULESET_ID,
    supportLevel: "engine_tested",
    keywords: ["human rights", "refugee", "migrant", "women", "child", "indigenous", "culture", "humanitarian", "education", "freedom"],
  },
  {
    id: "WHO_HMUN",
    name: "World Health Organization (HMUN-style committee)",
    body: "Simulated as an HMUN General Assembly committee",
    mandate: "International health matters.",
    eligibility: "WHO Member States.",
    rulesetId: RULESET_ID,
    supportLevel: "engine_tested",
    keywords: ["health", "pandemic", "vaccine", "disease", "medical", "medicine", "epidemic", "mental health", "hospital"],
    disclaimer:
      "Runs HMUN general committee rules, as HMUN lists WHO among its GA committees. It does NOT implement the real World Health Assembly procedure.",
  },
  {
    id: "ECOFIN",
    name: "Economic and Financial Committee",
    body: "UN General Assembly — Second Committee",
    mandate: "Economic growth, development, finance and trade questions.",
    eligibility: "Any UN Member State.",
    rulesetId: RULESET_ID,
    supportLevel: "engine_tested",
    keywords: ["economy", "trade", "debt", "finance", "development", "poverty", "tax", "investment"],
  },
  {
    id: "SPECPOL",
    name: "Special Political and Decolonization Committee",
    body: "UN General Assembly — Fourth Committee",
    mandate: "Decolonization, peacekeeping, outer space, mine action and other special political questions.",
    eligibility: "Any UN Member State.",
    rulesetId: RULESET_ID,
    supportLevel: "engine_tested",
    keywords: ["decoloni", "peacekeeping", "outer space", "mine action", "territor", "palestin", "self-determination"],
  },
  {
    id: "UNSC",
    name: "Security Council",
    body: "UN Security Council",
    mandate: "Maintenance of international peace and security.",
    eligibility: "15 members: 5 permanent (China, France, Russian Federation, United Kingdom, United States) + 10 elected.",
    rulesetId: null,
    supportLevel: "planned",
    keywords: ["sanction", "peace operation", "ceasefire", "conflict"],
    disclaimer:
      "Planned as a separate module (Charter Art. 27: 9 affirmative votes; substantive matters require no negative vote of a permanent member). Not available yet.",
  },
];

export function suggestCommittees(agenda: string): CommitteeId[] {
  const text = agenda.toLowerCase();
  return COMMITTEES.filter((c) => c.supportLevel !== "planned")
    .map((c) => ({ id: c.id, score: c.keywords.filter((k) => text.includes(k)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.id);
}
