import "server-only";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Country position materials, used as POLICY CONTEXT for AI delegations.
 * - Each country chunk belongs to exactly one country; another country's material is never used for a seat.
 * - "intl" chunks are COMMON BACKGROUND (UN/treaty/research): shown separately and never as a country's position.
 * - A forum pins one set version at creation (forum.positionSetVersion); later sets never change a running forum.
 * - Text inside materials is data, never instructions (prompts say so; procedure settings in sources are not loaded).
 * - Every chunk carries its source type and verification status, so official policy, national facts, negotiation
 *   records, research and student/team summaries are never confused.
 */
export const SOURCE_TYPES = [
  "official_position", // government / ministry / official statement or submission
  "negotiation_record", // what the country said in a negotiation, as recorded by a reporting service (e.g. ENB)
  "national_context", // facts about the country (economy, budget, exposure) — not a stated position
  "team_research", // student/team-compiled profile of real events, with sources (partly verified)
  "student_summary", // student-written stance / interpretation (unverified unless marked)
  "intl_background", // UN / treaty / international-organisation text shared by all
  "research", // academic findings — show an effect, NOT any government's policy
  "simulation_assumption", // classroom scenario setting
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
export const VERIFICATION = ["verified", "partly", "unverified", "contradicted"] as const;

export const PositionChunkZ = z.object({
  id: z.string().min(1),
  country: z.string().regex(/^([a-z]{2}|intl)$/),
  agenda: z.string().min(1), // agenda key, e.g. "climate-adaptation-finance"
  subtopic: z.string().default(""),
  title: z.string().default(""),
  date: z.string().default(""), // date of the material (YYYY, YYYY-MM or YYYY-MM-DD)
  source: z.string().default(""), // publisher / short source label
  url: z.string().default(""),
  docId: z.string().default(""),
  location: z.string().default(""), // page / paragraph / article
  sourceType: z.enum(SOURCE_TYPES).default("student_summary"),
  verification: z.enum(VERIFICATION).default("unverified"),
  text: z.string().min(1),
});
export type PositionChunk = z.infer<typeof PositionChunkZ>;

const ItemZ = z.object({ text: z.string().min(1), evidence: z.array(z.string()).default([]) });
/** A country's identity on one agenda: what it wants, what it cannot accept, what it can offer — each with evidence ids. */
export const ProfileZ = z.object({
  country: z.string().regex(/^[a-z]{2}$/),
  agenda: z.string(),
  asOf: z.string().default(""),
  basis: z.string().default(""), // e.g. "official sources (verified)" / "team research, partly verified"
  summary: z.string().default(""),
  priorities: z.array(ItemZ).default([]),
  supports: z.array(ItemZ).default([]),
  opposes: z.array(ItemZ).default([]),
  redLines: z.array(ItemZ).default([]),
  interests: z.array(ItemZ).default([]), // financial / technological / industrial stakes
  offers: z.array(ItemZ).default([]), // conditions it can put on the table
  partners: z.array(ItemZ).default([]), // issue-specific alignments (never a fixed vote table)
  style: z.string().default(""),
  caveats: z.array(z.string()).default([]),
});
export type Profile = z.infer<typeof ProfileZ>;

export const SourceZ = z.object({
  docId: z.string(),
  title: z.string(),
  url: z.string().default(""),
  publisher: z.string().default(""),
  date: z.string().default(""),
  sourceType: z.enum(SOURCE_TYPES),
  verification: z.enum(VERIFICATION).default("unverified"),
});

export const PositionSetZ = z.object({
  version: z.string().min(1),
  kind: z.enum(["fixture", "real"]),
  note: z.string().default(""),
  agendas: z.array(z.object({ key: z.string(), title: z.string().default(""), keywords: z.array(z.string()) })).default([]),
  profiles: z.array(ProfileZ).default([]),
  sources: z.array(SourceZ).default([]),
  chunks: z.array(PositionChunkZ),
});
export type PositionSet = z.infer<typeof PositionSetZ>;

const cache = new Map<string, PositionSet>();

export function loadPositionSet(
  version: string | null | undefined,
  dir = process.env.POSITIONS_DIR ?? path.join(process.cwd(), "data", "positions"),
): PositionSet | null {
  if (!version || version === "none" || !/^[A-Za-z0-9._-]+$/.test(version)) return null;
  const hit = cache.get(`${dir}:${version}`);
  if (hit) return hit;
  const file = path.join(dir, `${version}.json`);
  if (!existsSync(file)) return null;
  const set = PositionSetZ.parse(JSON.parse(readFileSync(file, "utf8")));
  if (set.version !== version) throw new Error(`position set file ${version} declares version ${set.version}`);
  cache.set(`${dir}:${version}`, set);
  return set;
}

export type MatchLevel = "exact" | "partial" | "none";
export type Scored = PositionChunk & { score: number };
export type Retrieval = {
  matchLevel: MatchLevel;
  agendaKey: string | null;
  profile: Profile | null;
  /** This country's material (best first). */
  chunks: Scored[];
  /** Common background (UN / treaty / research) — never this country's position. */
  background: Scored[];
  /** Ids the model may cite: exactly the material it was shown. */
  citeable: Set<string>;
};

/** Korean agenda/topic words mapped to the English terms used in the materials (free-text agendas in either language). */
const KO_EN: Array<[RegExp, string]> = [
  [/기후|온난화|탄소|배출/, "climate emissions warming"],
  [/적응/, "adaptation"],
  [/재원|재정|기금|자금|금융/, "finance funding fund"],
  [/손실|피해/, "loss damage"],
  [/보건|건강|의료|감염|전염|팬데믹|백신|에볼라/, "health pandemic vaccine outbreak"],
  [/플라스틱/, "plastic plastics"],
  [/광물|심해|채굴|해저/, "minerals deep-sea mining seabed"],
  [/디지털|정보 격차|격차/, "digital inclusion"],
  [/소비|생산|순환/, "consumption production circular"],
  [/난민|이주|이재민/, "displacement migration refugees"],
];
export function normalize(text: string): string {
  let t = text.toLowerCase();
  for (const [re, en] of KO_EN) if (re.test(t)) t += ` ${en}`;
  return t;
}
const words = (s: string) => normalize(s).match(/[a-z0-9]+|[가-힣]+/g) ?? [];

/** Which agenda key of the set best fits the forum agenda text (keyword overlap, English or Korean). */
export function resolveAgendaKey(set: PositionSet, agendaText: string): string | null {
  const t = normalize(agendaText);
  let best: { key: string; score: number } | null = null;
  let tie = false;
  for (const a of set.agendas) {
    const score = a.keywords.filter((k) => t.includes(k.toLowerCase())).length;
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { key: a.key, score };
      tie = false;
    } else if (score === best.score) tie = true;
  }
  return best && !tie ? best.key : null;
}

const TYPE_WEIGHT: Record<SourceType, number> = {
  official_position: 1,
  negotiation_record: 0.9,
  national_context: 0.8,
  team_research: 0.7,
  student_summary: 0.5,
  intl_background: 0.6,
  research: 0.5,
  simulation_assumption: 0.3,
};
const VERIF_WEIGHT = { verified: 1, partly: 0.85, unverified: 0.7, contradicted: 0 } as const;

function rank(pool: PositionChunk[], q: Set<string>, k: number): Scored[] {
  return pool
    .filter((c) => c.verification !== "contradicted")
    .map((c) => {
      const w = words(`${c.title} ${c.subtopic} ${c.text}`);
      const hits = w.filter((x) => q.has(x)).length;
      const lexical = hits / Math.sqrt(w.length + 1);
      return { ...c, score: (lexical + 0.05) * TYPE_WEIGHT[c.sourceType] * VERIF_WEIGHT[c.verification] };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, k);
}

/**
 * Country filter FIRST (never another country's material), then agenda:
 *  exact   = this country has a profile or material for the forum's agenda
 *  partial = this country has material only for other agendas (labelled; never presented as exact)
 *  none    = no material for this country
 * Within the pool, chunks are ranked by overlap with `query` (the current motion / clause / topic / record),
 * weighted by source type and verification. Common background for the agenda is added separately (max 2).
 */
export function retrieve(set: PositionSet | null, country: string, agendaText: string, query: string, k = 5): Retrieval {
  const empty: Retrieval = { matchLevel: "none", agendaKey: null, profile: null, chunks: [], background: [], citeable: new Set() };
  if (!set) return empty;
  const agendaKey = resolveAgendaKey(set, agendaText);
  const q = new Set(words(`${query} ${agendaText}`));
  const mine = set.chunks.filter((c) => c.country === country);
  const exact = agendaKey ? mine.filter((c) => c.agenda === agendaKey) : [];
  const profile = (agendaKey && set.profiles.find((p) => p.country === country && p.agenda === agendaKey)) || null;
  const level: MatchLevel = exact.length || profile ? "exact" : mine.length ? "partial" : "none";
  const chunks = rank(exact.length ? exact : level === "partial" ? mine : [], q, k);
  const background = agendaKey ? rank(set.chunks.filter((c) => c.country === "intl" && c.agenda === agendaKey), q, 2) : [];
  const citeable = new Set<string>([...chunks, ...background].map((c) => c.id));
  if (profile) for (const list of [profile.priorities, profile.supports, profile.opposes, profile.redLines, profile.interests, profile.offers, profile.partners]) for (const it of list) for (const id of it.evidence) citeable.add(id);
  return { matchLevel: level, agendaKey, profile, chunks, background, citeable };
}

/** Title / url / type of cited ids, for the "Why did the AI do that?" panel (only ids that exist in the set). */
export function sourceRefs(set: PositionSet | null, ids: string[]) {
  if (!set) return [];
  const out: Array<{ id: string; title: string; url: string; type: SourceType; verification: string; location: string }> = [];
  for (const id of ids) {
    const c = set.chunks.find((x) => x.id === id);
    if (!c) continue;
    out.push({ id, title: c.title || c.source, url: c.url, type: c.sourceType, verification: c.verification, location: c.location });
  }
  return out.slice(0, 6);
}
