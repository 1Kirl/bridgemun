/**
 * Converts a student research file into a versioned position set (data/positions/<version>.json).
 * Development tool only (no admin UI). Nothing is merged across countries.
 *
 *   npx tsx scripts/ingest-positions.ts <input.txt> <version> [--dry-run]
 *
 * Input format (one block per country × agenda × subtopic; paragraphs become chunks):
 *
 *   --- country: fr | agenda: WHO-vaccine-equity | subtopic: technology transfer
 *   title: France on vaccine technology transfer | date: 2026-10-01 | source: Team 2 / https://... | page: 3
 *   First paragraph ...
 *
 *   Second paragraph ...
 *
 * Agenda keywords (used to match a forum's agenda text) go in lines like:
 *   === agenda: WHO-vaccine-equity | keywords: vaccine, pandemic, immunization
 *
 * The script prints a report (counts per country/agenda, blocks missing metadata) and refuses to write
 * when a block has no country or agenda, so unclear structure is surfaced before use.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

type Chunk = { id: string; country: string; agenda: string; subtopic: string; title: string; date: string; source: string; location: string; text: string };

function parse(input: string) {
  const agendas: Array<{ key: string; keywords: string[] }> = [];
  const chunks: Chunk[] = [];
  const problems: string[] = [];
  let header: Record<string, string> | null = null;
  let meta: Record<string, string> = {};
  let para: string[] = [];
  let blockNo = 0;
  let paraNo = 0;
  const kv = (line: string) =>
    Object.fromEntries(
      line.split("|").map((p) => {
        const i = p.indexOf(":");
        return [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim()];
      }),
    );
  const flush = () => {
    const text = para.join(" ").trim();
    para = [];
    if (!text || !header) return;
    paraNo++;
    chunks.push({
      id: `${header.country}-${header.agenda}-${blockNo}-${paraNo}`.replace(/[^A-Za-z0-9-]/g, "").slice(0, 80),
      country: header.country,
      agenda: header.agenda,
      subtopic: header.subtopic ?? "",
      title: meta.title ?? "",
      date: meta.date ?? "",
      source: meta.source ?? "",
      location: meta.page ? `p${meta.page}${paraNo ? ` ¶${paraNo}` : ""}` : `¶${paraNo}`,
      text,
    });
  };
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("===")) {
      const m = kv(line.replace(/^=+/, ""));
      if (m.agenda) agendas.push({ key: m.agenda, keywords: (m.keywords ?? "").split(",").map((s) => s.trim()).filter(Boolean) });
      continue;
    }
    if (line.startsWith("---")) {
      flush();
      blockNo++;
      paraNo = 0;
      meta = {};
      header = kv(line.replace(/^-+/, ""));
      header.country = (header.country ?? "").toLowerCase();
      if (!/^[a-z]{2}$/.test(header.country)) problems.push(`block ${blockNo}: missing/invalid country code`);
      if (!header.agenda) problems.push(`block ${blockNo}: missing agenda`);
      continue;
    }
    if (header && !Object.keys(meta).length && /^title\s*:/i.test(line)) {
      meta = kv(line);
      continue;
    }
    if (!line) flush();
    else para.push(line);
  }
  flush();
  return { agendas, chunks, problems };
}

const [input, version, flag] = process.argv.slice(2);
if (!input || !version) {
  console.error("usage: tsx scripts/ingest-positions.ts <input.txt> <version> [--dry-run]");
  process.exit(2);
}
const { agendas, chunks, problems } = parse(readFileSync(input, "utf8"));
const byKey = new Map<string, number>();
for (const c of chunks) byKey.set(`${c.country} × ${c.agenda}`, (byKey.get(`${c.country} × ${c.agenda}`) ?? 0) + 1);
console.log(`chunks: ${chunks.length}, agendas with keywords: ${agendas.length}`);
for (const [k, n] of [...byKey].sort()) console.log(`  ${k}: ${n}`);
const noMeta = chunks.filter((c) => !c.source || !c.date).length;
if (noMeta) console.log(`warning: ${noMeta} chunk(s) without source or date`);
if (problems.length) {
  console.log("problems:\n  " + problems.join("\n  "));
  process.exit(1);
}
if (flag !== "--dry-run") {
  const out = path.join("data", "positions", `${version}.json`);
  if (existsSync(out)) {
    console.error(`${out} exists; versions are immutable — choose a new version name`);
    process.exit(1);
  }
  writeFileSync(out, JSON.stringify({ version, kind: "real", note: `ingested from ${path.basename(input)}`, agendas, chunks }, null, 2));
  console.log(`wrote ${out}`);
}
