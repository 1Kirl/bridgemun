/** The real research set (data/positions/real-2026-11-27.json): structure, isolation, labels and retrieval. */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadPositionSet, retrieve, resolveAgendaKey, sourceRefs } from "@/server/positions/positions";
import { evidenceBlock } from "@/server/ai/prompts";

const set = loadPositionSet("real-2026-11-27", path.join(process.cwd(), "data", "positions"))!;
const CLIMATE = "Climate change: scaling up adaptation finance for vulnerable countries";

describe("real research set", () => {
  it("is labelled real and separate from the fixture", () => {
    expect(set.kind).toBe("real");
    expect(set.chunks.some((c) => c.text.startsWith("FIXTURE"))).toBe(false);
  });

  it("every chunk has a source type, a verification status and a traceable source", () => {
    for (const c of set.chunks) {
      expect(c.sourceType).toBeTruthy();
      expect(c.verification).toBeTruthy();
      expect(c.url || c.source).toBeTruthy();
    }
    expect(set.chunks.some((c) => c.verification === "contradicted")).toBe(false); // corrected or dropped at build time
  });

  it("procedure / observer / 'ground truth' settings from the sources are not loaded", () => {
    const all = JSON.stringify(set);
    expect(all).not.toMatch(/observersCanVote|UNA-USA|must not contradict them/);
  });

  it("free-text agendas in English and Korean resolve to the right agenda", () => {
    expect(resolveAgendaKey(set, CLIMATE)).toBe("climate-adaptation-finance");
    expect(resolveAgendaKey(set, "기후변화 적응 재원")).toBe("climate-adaptation-finance");
    expect(resolveAgendaKey(set, "Breaking the deadlock on a global plastics treaty")).toBe("plastics-treaty");
    expect(resolveAgendaKey(set, "심해 채굴과 핵심 광물")).toBe("critical-minerals-deep-sea");
    expect(resolveAgendaKey(set, "Lethal autonomous weapons")).toBeNull();
  });

  it("a country only ever gets its own material; UN/research text comes as labelled background", () => {
    for (const cc of ["us", "kr", "in", "bd", "sa"]) {
      const r = retrieve(set, cc, CLIMATE, "tripling adaptation finance grants");
      expect(r.matchLevel).toBe("exact");
      expect(r.chunks.every((c) => c.country === cc)).toBe(true);
      expect(r.background.every((c) => c.country === "intl")).toBe(true);
      expect(r.profile?.country).toBe(cc);
    }
    const block = evidenceBlock(retrieve(set, "kr", CLIMATE, "contributor base"));
    expect(block).toContain("COMMON BACKGROUND (not any country's position)");
    expect(block).toContain("YOUR COUNTRY'S IDENTITY");
  });

  it("the same proposal gets different, country-specific evidence (no shared verdict)", () => {
    const q = "broaden the contributor base so that all countries in a position to do so provide climate finance";
    const us = retrieve(set, "us", CLIMATE, q);
    const kr = retrieve(set, "kr", CLIMATE, q);
    const india = retrieve(set, "in", CLIMATE, q);
    expect(us.profile!.summary).toMatch(/Paris Agreement/);
    expect(kr.profile!.redLines.map((x) => x.text).join(" ")).toMatch(/voluntary/i);
    expect(india.profile!.summary).toMatch(/9\.1/);
    const ids = (r: typeof us) => new Set(r.chunks.map((c) => c.id));
    expect([...ids(us)].some((id) => ids(kr).has(id))).toBe(false);
  });

  it("partial / none are labelled and never borrow another country", () => {
    const r = retrieve(set, "mx", CLIMATE, "adaptation");
    expect(r.matchLevel).toBe("partial"); // Mexico has WHO material only
    expect(r.chunks.every((c) => c.country === "mx")).toBe(true);
    expect(retrieve(set, "it", CLIMATE, "adaptation").chunks).toEqual([]);
  });

  it("only material actually shown can be cited, and cited ids resolve to titles and links", () => {
    const r = retrieve(set, "bd", CLIMATE, "adaptation needs grant loss and damage");
    expect(r.citeable.has("bd-ndc3-2025")).toBe(true);
    expect(r.citeable.has("us-eo-14162-paris")).toBe(false);
    const refs = sourceRefs(set, ["bd-ndc3-2025", "made-up-id"]);
    expect(refs).toHaveLength(1);
    expect(refs[0].url).toMatch(/^https:\/\/unfccc\.int\//);
    expect(refs[0].type).toBe("official_position");
  });

  it("student stances keep their record-check caveats (e.g. Saudi Arabia speaking for the Arab Group)", () => {
    const sa = set.profiles.find((p) => p.country === "sa" && p.agenda === "plastics-treaty")!;
    expect(sa.caveats.join(" ")).toMatch(/Arab Group/);
    const pl = set.chunks.find((c) => c.id === "pl-sa-student")!;
    expect(pl.sourceType).toBe("student_summary");
  });
});
