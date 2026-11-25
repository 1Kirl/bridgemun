import "server-only";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Country position materials (student research), used as POLICY CONTEXT for AI delegations.
 * - Each chunk belongs to exactly one country; chunks of different countries are never merged.
 * - A forum pins one set version at creation (forum.positionSetVersion); later uploads do not change it.
 * - Text inside materials is data, never instructions (prompts state this explicitly).
 */
export const PositionChunkZ = z.object({
  id: z.string().min(1),
  country: z.string().regex(/^[a-z]{2}$/),
  agenda: z.string().min(1), // agenda key, e.g. "WHO-vaccine-equity"
  subtopic: z.string().default(""),
  title: z.string().default(""),
  date: z.string().default(""), // ISO date of the material
  source: z.string().default(""),
  location: z.string().default(""), // page / paragraph
  text: z.string().min(1),
});
export type PositionChunk = z.infer<typeof PositionChunkZ>;

export const PositionSetZ = z.object({
  version: z.string().min(1),
  kind: z.enum(["fixture", "real"]),
  note: z.string().default(""),
  agendas: z.array(z.object({ key: z.string(), keywords: z.array(z.string()) })).default([]),
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
export type Retrieval = { matchLevel: MatchLevel; agendaKey: string | null; chunks: Array<PositionChunk & { score: number }> };

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Which agenda key of the set best fits the forum agenda text (keyword overlap). */
export function resolveAgendaKey(set: PositionSet, agendaText: string): string | null {
  const t = agendaText.toLowerCase();
  let best: { key: string; score: number } | null = null;
  for (const a of set.agendas) {
    const score = a.keywords.filter((k) => t.includes(k.toLowerCase())).length;
    if (score > 0 && (!best || score > best.score)) best = { key: a.key, score };
  }
  return best?.key ?? null;
}

/**
 * Country filter FIRST (never another country's material), then agenda:
 *  exact   = same country + forum agenda key
 *  partial = same country, other agenda (labelled as partial, never presented as exact)
 *  none    = no material for this country
 * Within the result, chunks are ranked by keyword overlap with `query` (BM25-lite).
 */
export function retrieve(set: PositionSet | null, country: string, agendaText: string, query: string, k = 4): Retrieval {
  if (!set) return { matchLevel: "none", agendaKey: null, chunks: [] };
  const agendaKey = resolveAgendaKey(set, agendaText);
  const mine = set.chunks.filter((c) => c.country === country);
  const exact = agendaKey ? mine.filter((c) => c.agenda === agendaKey) : [];
  const pool = exact.length ? exact : mine;
  const level: MatchLevel = exact.length ? "exact" : mine.length ? "partial" : "none";
  const q = new Set(words(query));
  const scored = pool
    .map((c) => {
      const w = words(`${c.title} ${c.subtopic} ${c.text}`);
      const hits = w.filter((x) => q.has(x)).length;
      return { ...c, score: hits / Math.sqrt(w.length + 1) };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, k);
  return { matchLevel: level, agendaKey, chunks: scored };
}
