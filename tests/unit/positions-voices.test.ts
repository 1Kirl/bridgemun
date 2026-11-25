import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadPositionSet, retrieve, resolveAgendaKey } from "@/server/positions/positions";
import { assignVoices, VOICE_POOL } from "@/server/speech/voices";

const set = loadPositionSet("fixture-v0", path.join(process.cwd(), "data", "positions"))!;

describe("position retrieval (country first, then agenda)", () => {
  it("fixture is labelled as a fixture", () => {
    expect(set.kind).toBe("fixture");
    expect(set.chunks.every((c) => c.text.startsWith("FIXTURE"))).toBe(true);
  });
  it("exact: same country + agenda", () => {
    const r = retrieve(set, "fr", "Pandemic vaccine sharing", "technology transfer licensing");
    expect(r.matchLevel).toBe("exact");
    expect(r.chunks.every((c) => c.country === "fr")).toBe(true);
    expect(r.chunks[0].id).toBe("fx-fr-vax-1");
  });
  it("partial: same country, different agenda — never presented as exact", () => {
    const r = retrieve(set, "jp", "Pandemic vaccine sharing", "vaccine");
    expect(r.matchLevel).toBe("partial");
    expect(r.chunks.every((c) => c.country === "jp")).toBe(true);
  });
  it("none: no material for this country; another country's material is never used", () => {
    const r = retrieve(set, "it", "Pandemic vaccine sharing", "vaccine");
    expect(r).toMatchObject({ matchLevel: "none", chunks: [] });
  });
  it("no set pinned → none", () => {
    expect(retrieve(null, "fr", "x", "y").matchLevel).toBe("none");
    expect(loadPositionSet("none")).toBeNull();
    expect(loadPositionSet("../etc/passwd")).toBeNull();
  });
  it("agenda key from forum agenda text", () => {
    expect(resolveAgendaKey(set, "Lethal autonomous weapons systems")).toBe("DISEC-autonomous-weapons");
    expect(resolveAgendaKey(set, "Ocean plastics")).toBeNull();
  });
});

describe("voice mapping", () => {
  it("stable, no duplicates while the pool suffices, excludes nationality-named voices", () => {
    const seats = ["fr", "de", "jp", "it", "gb", "ca"];
    const a = assignVoices("forum1", seats);
    const b = assignVoices("forum1", [...seats].reverse());
    expect(a).toEqual(b);
    expect(new Set(Object.values(a).map((v) => v.voiceId)).size).toBe(seats.length);
    expect(VOICE_POOL.some((v) => /brazil/i.test(v.label))).toBe(false);
  });
});
