// Builds a versioned position set (data/positions/<version>.json) for AI delegations from:
//   1. the provided materials (Google Docs + Drive folders), downloaded by scripts/research/fetch_provided.py
//      into .data/research/raw (git-ignored: originals are not republished);
//   2. curated, verified additional research in research/additional/*.json (short quotes + own-words points);
//   3. research/curated.json (hand-written summaries, corrections and exclusions).
// It also writes research/catalog.json (every provided item: used / excluded / duplicate / failed, with reasons)
// and research/COVERAGE.md (agenda × country coverage and gaps).
//
//   node scripts/research/build-set.mjs <version> [--dry-run]
//
// Policy encoded here (see research/README.md):
// - A country's chunks are only ever used for that country; UN/treaty/research text is "intl" background.
// - Every chunk has a source type (official position / negotiation record / national facts / team research /
//   student summary / background / research) and a verification status; contradicted claims are corrected or dropped.
// - Procedure, voting-right, observer and "ground truth" settings found inside sources are NOT loaded.
// - Versions are immutable: a new build needs a new version name; forums keep the version they were created with.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const [version, flag] = process.argv.slice(2);
if (!version || !/^[A-Za-z0-9._-]+$/.test(version)) {
  console.error("usage: node scripts/research/build-set.mjs <version> [--dry-run]");
  process.exit(2);
}
const RAW = ".data/research/raw";
const ADD = "research/additional";
const CUR = JSON.parse(readFileSync("research/curated.json", "utf8"));
const MANIFEST = JSON.parse(readFileSync(path.join(RAW, "manifest.json"), "utf8"));
const read = (p) => readFileSync(p, "utf8").replace(/^﻿/, "");
const words = (s) => s.trim().split(/\s+/);
const clip = (s, n) => {
  const w = words(s.replace(/\s+/g, " "));
  return w.length <= n ? w.join(" ") : `${w.slice(0, n).join(" ")}…`;
};

const AGENDAS = [
  { key: "climate-adaptation-finance", title: "Climate change and climate adaptation finance", keywords: ["climate", "adaptation", "global warming", "warming", "1.5", "loss and damage", "ncqg", "unfccc", "paris agreement", "emission", "green climate fund", "climate refugees"] },
  { key: "who-health-financing", title: "Health systems financing and outbreak preparedness (WHO)", keywords: ["health", "who", "world health", "pandemic", "outbreak", "ebola", "pabs", "vaccine", "disease", "medical"] },
  { key: "plastics-treaty", title: "A global plastics treaty", keywords: ["plastic", "plastics", "inc-5", "plastic pollution"] },
  { key: "critical-minerals-deep-sea", title: "Critical minerals and deep-sea mining", keywords: ["critical mineral", "minerals", "deep-sea", "deep sea", "seabed", "mining", "lithium", "cobalt", "unclos", "isa"] },
  { key: "digital-inclusion", title: "Digital inclusion", keywords: ["digital", "inclusion", "digital divide", "older adults", "ict"] },
  { key: "sustainable-consumption-production", title: "Sustainable consumption and production", keywords: ["sustainable consumption", "consumption", "production patterns", "circular economy", "agenda 21"] },
];

const out = { version, kind: "real", note: "", agendas: AGENDAS, profiles: [], sources: [], chunks: [] };
const catalog = [];
const ids = new Set();
const srcIds = new Set();
function addSource(s) {
  if (srcIds.has(s.docId)) return;
  srcIds.add(s.docId);
  out.sources.push({ docId: s.docId, title: s.title, url: s.url ?? "", publisher: s.publisher ?? "", date: s.date ?? "", sourceType: s.sourceType, verification: s.verification ?? "unverified" });
}
function addChunk(c) {
  if (ids.has(c.id)) throw new Error(`duplicate chunk id ${c.id}`);
  if (!c.text?.trim()) return null;
  ids.add(c.id);
  out.chunks.push({ subtopic: "", title: "", date: "", source: "", url: "", docId: "", location: "", verification: "unverified", ...c, text: c.text.replace(/\s+/g, " ").trim() });
  return c.id;
}
const profileFor = (country, agenda) => {
  let p = out.profiles.find((x) => x.country === country && x.agenda === agenda);
  if (!p) out.profiles.push((p = { country, agenda, asOf: "", basis: "", summary: "", priorities: [], supports: [], opposes: [], redLines: [], interests: [], offers: [], partners: [], style: "", caveats: [] }));
  return p;
};
const item = (text, evidence) => ({ text: clip(text, 60), evidence: evidence.filter(Boolean) });
const fromManifest = (p) => MANIFEST.find((m) => m.path === p);
const driveUrl = (p) => fromManifest(p)?.url ?? "";

// ── 1. WHO agenda: team-researched country profiles (folder A) ───────────────────────────────
const VER = JSON.parse(read(path.join(ADD, "verification.json")));
const STATUS = { verified: "verified", partly: "partly", not_verified: "unverified", contradicted: "contradicted", supported: "verified", nuanced: "partly", no_record: "unverified" };
const overlap = (a, b) => {
  const A = new Set(a.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const B = b.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return B.filter((w) => A.has(w)).length / Math.max(1, B.length);
};
const WHO_ISO = CUR.whoIso;
const CORR = CUR.corrections; // [{country, match (regex), text, verification, note}]
const corrected = new Set();
for (const [file, cc] of Object.entries(WHO_ISO)) {
  const p = `/folderA/${file}.json`;
  const d = JSON.parse(read(path.join(RAW, "drive", p)));
  const docId = `team-who-${cc}`;
  addSource({ docId, title: `${d.country}: WHO health-financing profile (team research, reviewed ${d.review?.reviewedOn ?? ""})`, url: driveUrl(p), publisher: "BridgeMUN team research (provided)", date: d.government?.asOf ?? "", sourceType: "team_research", verification: "partly" });
  catalog.push({ item: `Drive folder A: ${file}.json`, url: driveUrl(p), status: "used", as: `team_research profile for ${cc} (WHO agenda)`, excludedFields: ["status (observer/member)", "allies/rivals as fixed lists (converted to issue-specific notes)", "review notes"] });
  const base = { country: cc, agenda: "who-health-financing", docId, source: "BridgeMUN team research", date: d.review?.reviewedOn ?? "", sourceType: "team_research" };
  const posId = addChunk({ ...base, id: `who-${cc}-position`, title: `${d.country}: position on health financing`, url: d.sources?.[0] ?? driveUrl(p), verification: "unverified", location: "positionSentence / objectives / redLines", text: `${d.positionSentence} Objectives: ${d.objectives.join("; ")}. Red lines: ${d.redLines.join("; ")}.` });
  const ctxIds = [];
  const claims = VER.who.filter((x) => x.country === file);
  [...d.context, ...(d.nuances ?? [])].forEach((t, i) => {
    let text = t;
    let verification = "unverified";
    const fix = CORR.find((c) => c.country === file && new RegExp(c.match, "i").test(t));
    if (fix) {
      corrected.add(fix.match);
      if (fix.drop) return;
      text = fix.text;
      verification = fix.verification;
    } else {
      const best = claims.map((c) => ({ c, s: overlap(t, c.claim) })).sort((a, b) => b.s - a.s)[0];
      if (best && best.s > 0.6) verification = STATUS[best.c.status] ?? "unverified";
    }
    if (verification === "contradicted") return; // never feed a contradicted claim
    const isNuance = i >= d.context.length;
    ctxIds.push(
      addChunk({ ...base, id: `who-${cc}-${isNuance ? "analysis" : "ctx"}-${i}`, title: `${d.country}: ${isNuance ? "team analysis" : "national context"}`, url: d.sources?.[0] ?? "", sourceType: isNuance ? "team_research" : "national_context", verification, location: isNuance ? `nuances[${i - d.context.length}]` : `context[${i}]`, text: isNuance ? `Team analysis (interpretation): ${text}` : text }),
    );
  });
  const pr = profileFor(cc, "who-health-financing");
  pr.asOf = d.government?.asOf ?? d.review?.reviewedOn ?? "";
  pr.basis = "team research reviewed 2026-10-17 (sources listed); key claims sample-checked 2026-11-27";
  pr.summary = d.positionSentence;
  pr.priorities = d.objectives.map((t) => item(t, [posId]));
  pr.redLines = d.redLines.map((t) => item(t, [posId]));
  pr.interests = ctxIds.filter(Boolean).slice(0, 3).map((id) => item(out.chunks.find((c) => c.id === id).text, [id]));
  if (d.allies?.length) pr.partners = [item(`Often aligned on this agenda with ${d.allies.map((a) => CUR.names[a] ?? a).join(", ")} (team research) — decide each proposal on its clauses, not on who moved it.`, [posId])];
  pr.style = [d.negotiationStyle, d.speakingStyle].filter(Boolean).join(" ");
  pr.caveats = ["Profile is team research; figures marked unverified must be hedged.", ...(CUR.whoCaveats[file] ?? [])];
}

// Fact sheet → shared background (its "ground truth" instruction is NOT loaded).
{
  const p = "/folderA/fact-sheet.json";
  const d = JSON.parse(read(path.join(RAW, "drive", p)));
  addSource({ docId: "team-who-factsheet", title: "WHO agenda fact sheet (team research, as of 2026-10-17)", url: driveUrl(p), publisher: "BridgeMUN team research (provided)", date: d.asOf, sourceType: "intl_background", verification: "partly" });
  catalog.push({ item: "Drive folder A: fact-sheet.json", url: driveUrl(p), status: "used", as: "intl background facts (WHO agenda)", excludedFields: ["instructions (\"ground truth … must not contradict\") — treated as data, not loaded"] });
  let n = 0;
  for (const sec of d.sections) for (const f of sec.facts) {
    const v = VER.factSheet.map((c) => ({ c, s: overlap(f.text, c.claim) })).sort((a, b) => b.s - a.s)[0];
    const fix = CORR.find((c) => c.country === "factsheet" && new RegExp(c.match, "i").test(f.text));
    if (fix) corrected.add(fix.match);
    const verification = fix ? fix.verification : v && v.s > 0.6 ? STATUS[v.c.status] : f.confidence === "verified" ? "partly" : "unverified";
    addChunk({ id: `who-intl-fact-${++n}`, country: "intl", agenda: "who-health-financing", docId: "team-who-factsheet", title: `Fact sheet: ${sec.title}`, date: d.asOf, source: "BridgeMUN team research", url: f.sources?.[0] ?? "", sourceType: "intl_background", verification, location: sec.id, text: fix ? fix.text : f.text });
  }
}
// Committee topic background (procedure block NOT loaded).
{
  const p = "/folderA/committee.json";
  const d = JSON.parse(read(path.join(RAW, "drive", p)));
  catalog.push({ item: "Drive folder A: committee.json", url: driveUrl(p), status: "used (topic only)", as: "intl background (WHO agenda)", excludedFields: ["procedure (UNA-USA rules, observersCanVote, closure majority, signatory fraction) — BridgeMUN uses hmun-ga-2026@1", "delegates list", "setting date"] });
  d.topic.background.forEach((t, i) => addChunk({ id: `who-intl-topic-${i + 1}`, country: "intl", agenda: "who-health-financing", docId: "team-who-committee", title: d.topic.title, date: "2026-10-17", source: "BridgeMUN team research", url: driveUrl(p), sourceType: "intl_background", verification: "unverified", location: `topic.background[${i}]`, text: t }));
  addSource({ docId: "team-who-committee", title: `Committee topic: ${d.topic.title}`, url: driveUrl(p), publisher: "BridgeMUN team research (provided)", date: "2026-10-17", sourceType: "intl_background", verification: "unverified" });
}
// Research papers (folder A): own-words summaries; never a government position.
for (const r of CUR.research) {
  if (r.file) catalog.push({ item: `Drive folder A: ${r.file}`, url: driveUrl(`/folderA/${r.file}`), status: "used", as: `research summary (${r.agenda})`, note: r.note ?? "" });
  addSource({ docId: r.id, title: r.title, url: r.url, publisher: r.publisher, date: r.date, sourceType: "research", verification: "verified" });
  addChunk({ id: r.id, country: r.country ?? "intl", agenda: r.agenda, docId: r.id, title: r.title, date: r.date, source: r.publisher, url: r.url, sourceType: "research", verification: "verified", location: "abstract / findings", text: `${r.summary} Limits: ${r.limits}` });
}

// ── 2. Plastics + deep-sea: student stances (SDG Content Task doc) checked against ENB ───────────────
{
  const p = "/folderB/BridgeMUN: SDG Content Task - RK";
  const doc = read(path.join(RAW, "drive", `${p}.txt`));
  const url = driveUrl(p);
  catalog.push({ item: "Drive folder B: BridgeMUN: SDG Content Task - RK (Google Doc)", url, status: "used (country stances only)", as: "student_summary profiles for plastics-treaty and critical-minerals-deep-sea (20 countries each) + Bangladesh climate displacement", excludedFields: ["assignment instructions and submission e-mail", "a cloudflared tunnel command and URL", "empty speech/action templates", "file table describing a RAG pipeline"] });
  addSource({ docId: "student-sdg-task", title: "SDG Content Task — student country stances (plastics, critical minerals, climate displacement)", url, publisher: "BridgeMUN students (provided)", date: "2026-10", sourceType: "student_summary", verification: "partly" });
  const lines = doc.split(/\r?\n/);
  const agendaAt = (i) => (lines.slice(0, i).reverse().find((l) => /^Agenda [AB]\./.test(l.trim())) ?? "").trim();
  const iso3 = CUR.iso3;
  lines.forEach((l, i) => {
    const m = l.trim().match(/^Country \d+: (.+) \(([A-Z]{3})\)$/);
    if (!m) return;
    const ag = agendaAt(i).startsWith("Agenda A") ? "plastics-treaty" : "critical-minerals-deep-sea";
    const cc = iso3[m[2]];
    const block = [];
    for (let j = i + 1; j < lines.length && !/^Country \d+:|^Agenda [AB]\.|^Important note|^의제/.test(lines[j].trim()); j++) block.push(lines[j]);
    const txt = block.join("\n");
    const sect = (re) => {
      const s = txt.split(/\n\s*\d\.\s+|\n2\.|\n3\./);
      return s;
    };
    void sect;
    const wantsPart = txt.split(/2\.\s*What limit/)[0];
    const limitPart = (txt.split(/2\.\s*What limit[^\n]*\n/)[1] ?? "").split(/3\.\s*Position sentence/)[0];
    const sentence = (txt.split(/3\.\s*Position sentence/)[1] ?? "").trim().split(/\n/).filter((x) => x.trim()).join(" ");
    const bullets = (s) => s.split(/\n/).map((x) => x.replace(/^\s*(\d\.|\*|-)\s*/, "").trim()).filter((x) => x && !/^1\.\s*What does|What does this country/.test(x));
    const wants = bullets(wantsPart);
    const limits = bullets(limitPart);
    const check = (ag === "plastics-treaty" ? VER.plastics : VER.deepSea).find((x) => CUR.verCountry[x.country] === cc);
    const verification = check ? STATUS[check.status] : "unverified";
    const id = addChunk({ id: `${ag === "plastics-treaty" ? "pl" : "dsm"}-${cc}-student`, country: cc, agenda: ag, docId: "student-sdg-task", title: `${m[1]}: student stance`, date: "2026-10", source: "BridgeMUN students", url, sourceType: "student_summary", verification, location: `${agendaAt(i)} · ${m[1]}`, text: `${sentence} Wants: ${wants.join("; ")}. Limits: ${limits.join("; ")}.` });
    const pr = profileFor(cc, ag);
    pr.asOf = "2026-10";
    pr.basis = check ? `student stance, checked against the Earth Negotiations Bulletin record (${check.status})` : "student stance (not independently checked)";
    pr.summary = sentence;
    pr.supports = wants.map((t) => item(t, [id]));
    pr.redLines = limits.map((t) => item(t, [id]));
    if (check?.note) pr.caveats.push(`Record check: ${clip(check.note, 70)}`);
    if (check?.enb) {
      const eid = addChunk({ id: `${ag === "plastics-treaty" ? "pl" : "dsm"}-${cc}-enb`, country: cc, agenda: ag, docId: ag === "plastics-treaty" ? "enb-inc52" : "enb-isa31", title: `${m[1]} in the negotiation record (ENB)`, date: ag === "plastics-treaty" ? "2025-08" : "2026-03/2026-08", source: "IISD Earth Negotiations Bulletin", url: ag === "plastics-treaty" ? CUR.enb.inc52 : CUR.enb.isa31b, sourceType: "negotiation_record", verification: "verified", location: (check.enb.match(/\[Page[^\]]+\]/) ?? [""])[0], text: `${check.enb} — ${clip(check.note ?? "", 50)}` });
      pr.priorities.unshift(item(`As recorded in negotiations: ${clip(check.note ?? check.enb, 40)}`, [eid]));
    }
    for (const extra of CUR.stanceNotes.filter((x) => x.country === cc && x.agenda === ag)) pr.caveats.push(extra.text);
  });
  // Bangladesh — climate displacement (top of the doc)
  const bdStart = lines.findIndex((l) => /^Country 1: Bangladesh/.test(l.trim()));
  const bdBlock = lines.slice(bdStart + 1, bdStart + 20).join("\n");
  const bdSentence = (bdBlock.split(/3\.\s*Complete this position sentence:\s*/)[1] ?? "").trim().split(/\n/)[0];
  const bdWants = (bdBlock.split(/2\./)[0].match(/\* .+/g) ?? []).map((x) => x.slice(2));
  const bdLim = ((bdBlock.split(/2\.[^\n]*\n/)[1] ?? "").split(/3\./)[0].match(/\* .+/g) ?? []).map((x) => x.slice(2));
  const bid = addChunk({ id: "cl-bd-student-displacement", country: "bd", agenda: "climate-adaptation-finance", subtopic: "climate displacement", docId: "student-sdg-task", title: "Bangladesh: student stance on climate displacement", date: "2026-10", source: "BridgeMUN students", url, sourceType: "student_summary", verification: "unverified", location: "SDG 13 · Country 1: Bangladesh", text: `${bdSentence} Wants: ${bdWants.join("; ")}. Limits: ${bdLim.join("; ")}.` });
  CUR._bdStudent = { id: bid, wants: bdWants, limits: bdLim, sentence: bdSentence };
  // Agenda B framing note → background
  const note = lines.findIndex((l) => /^Important note for Agenda B/.test(l.trim()));
  if (note > 0) addChunk({ id: "dsm-intl-framework", country: "intl", agenda: "critical-minerals-deep-sea", docId: "student-sdg-task", title: "Three approaches to deep-sea mining (class framework)", date: "2026-10", source: "BridgeMUN students", url, sourceType: "simulation_assumption", verification: "unverified", location: "Important note for Agenda B", text: lines.slice(note + 1, note + 6).join(" ") });
}

// ENB / UNEP / UNCLOS (folder B rag-data): headers give the citation; text is excerpted, never copied whole.
const header = (t) => Object.fromEntries((t.split(/^=+$/m)[1] ?? "").split("\n").map((l) => l.match(/^([A-Z ]+):\s*(.*)$/)).filter(Boolean).map((m) => [m[1].trim(), m[2].trim()]));
for (const f of CUR.ragFiles) {
  const p = `/folderB/rag-data/${f.file}`;
  const m = fromManifest(p);
  if (f.exclude) {
    catalog.push({ item: `Drive folder B: rag-data/${f.file}`, url: m?.url ?? "", status: "excluded", reason: f.exclude });
    continue;
  }
  const t = read(path.join(RAW, "drive", p));
  const h = header(t);
  const docId = f.id;
  addSource({ docId, title: h.TITLE ?? f.file, url: (h.SOURCE ?? "").split(" ")[0], publisher: h.PUBLISHER ?? "", date: h["DOCUMENT DATE"] ?? "", sourceType: f.sourceType, verification: "verified" });
  catalog.push({ item: `Drive folder B: rag-data/${f.file}`, url: m?.url ?? "", status: "used", as: f.as });
  for (const [i, s] of (f.summaries ?? []).entries()) addChunk({ id: `${docId}-${i + 1}`, country: "intl", agenda: f.agenda, docId, title: h.TITLE ?? f.file, date: h["DOCUMENT DATE"] ?? "", source: h.PUBLISHER ?? "", url: (h.SOURCE ?? "").split(" ")[0], sourceType: f.sourceType, verification: "verified", location: s.location ?? "", text: s.text });
  for (const art of f.articles ?? []) {
    const am = t.match(new RegExp(`Article ${art}\\s*\\n([\\s\\S]*?)(?=\\nArticle \\d+\\s*\\n|$)`));
    if (am) addChunk({ id: `${docId}-art${art}`, country: "intl", agenda: f.agenda, docId, title: `UNCLOS Article ${art}`, date: "1982-12-10", source: "United Nations", url: (h.SOURCE ?? "").split(" ")[0], sourceType: "intl_background", verification: "verified", location: `Article ${art}`, text: clip(am[1], 110) });
  }
  // Countries not checked by hand: short ENB excerpts that name them (with page), labelled as excerpts.
  for (const [cc, name] of Object.entries(f.excerptCountries ?? {})) {
    let page = "";
    let n = 0;
    for (const para of t.split(/\n\s*\n/)) {
      const pm = para.match(/\[Page (\d+)\]/);
      if (pm) page = `Page ${pm[1]}`;
      if (n >= 2) break;
      const flat = para.replace(/\s+/g, " ");
      const sent = flat.split(/(?<=\.)\s+/).find((x) => new RegExp(`\\b${name}\\b`).test(x) && x.length > 60 && !/co-chair|co-facilitat|facilitated by|chaired by|Vice-Chair|Bureau/i.test(x));
      if (!sent) continue;
      n++;
      addChunk({ id: `${docId}-${cc}-x${n}`, country: cc, agenda: f.agenda, docId, title: `${name} in the negotiation record (ENB excerpt)`, date: h["DOCUMENT DATE"] ?? "", source: h.PUBLISHER ?? "", url: (h.SOURCE ?? "").split(" ")[0], sourceType: "negotiation_record", verification: "verified", location: page, text: `${clip(sent, 55)} (Excerpt; check whether ${name} spoke for itself or for a group.)` });
    }
  }
}

// ── 3. Provided Google Docs (direct links) ────────────────────────────────────────────────
for (const d of CUR.providedDocs) {
  catalog.push({ item: `Google Doc: ${d.title}`, url: d.url, status: d.status, as: d.as ?? "", reason: d.reason ?? "" });
  if (d.status !== "used") continue;
  addSource({ docId: d.id, title: d.title, url: d.sourceUrl ?? d.url, publisher: d.publisher, date: d.date, sourceType: d.sourceType, verification: d.verification });
  for (const [i, c] of d.chunks.entries()) addChunk({ id: `${d.id}-${i + 1}`, country: c.country ?? "intl", agenda: d.agenda, docId: d.id, title: d.title, date: d.date, source: d.publisher, url: d.sourceUrl ?? d.url, sourceType: c.sourceType ?? d.sourceType, verification: c.verification ?? d.verification, location: c.location ?? "", text: c.text });
}

// ── 4. Additional research (climate adaptation finance) ─────────────────────────────────────
for (const file of ["climate-donors.json", "climate-recipients.json"]) {
  const d = JSON.parse(read(path.join(ADD, file)));
  for (const doc of d.docs) {
    const group = doc.country.startsWith("group:") ? doc.country.slice(6) : null;
    const members = group ? (CUR.groups[group] ?? []) : [doc.country];
    const type = doc.type;
    addSource({ docId: doc.id, title: doc.title, url: doc.url, publisher: doc.publisher, date: doc.date, sourceType: group && group !== "cma" ? "negotiation_record" : type, verification: "verified" });
    const body = `${doc.points.join(" ")}${doc.quote ? ` Quote: “${doc.quote}”` : ""}${doc.caveats ? ` Caveat: ${doc.caveats}` : ""}`;
    for (const cc of members) {
      const id = addChunk({
        id: group ? `${doc.id}--${cc}` : doc.id,
        country: cc === "cma" ? "intl" : cc,
        agenda: "climate-adaptation-finance",
        docId: doc.id,
        title: group && group !== "cma" ? `${group} group position (not necessarily ${CUR.names2[cc] ?? cc}'s own wording): ${doc.title}` : doc.title,
        date: doc.date,
        source: doc.publisher,
        url: doc.url,
        sourceType: group === "cma" ? "intl_background" : group ? "negotiation_record" : type,
        verification: "verified",
        location: doc.location ?? "",
        text: clip(body, 140),
      });
      if (cc === "intl" || cc === "cma" || type === "research" || type === "intl_background") continue;
      const pr = profileFor(cc, "climate-adaptation-finance");
      const via = group ? ` (via ${group})` : "";
      for (const s of doc.supports ?? []) pr.supports.push(item(s + via, [id]));
      for (const s of doc.opposes ?? []) pr.opposes.push(item(s + via, [id]));
      for (const s of doc.redLines ?? []) pr.redLines.push(item(s + via, [id]));
      if (type === "national_context" && !group) for (const s of doc.points.slice(0, 2)) pr.interests.push(item(s, [id]));
      if (doc.date > (pr.asOf || "")) pr.asOf = doc.date;
    }
  }
  for (const nv of d.notVerified ?? []) catalog.push({ item: `Additional research claim: ${clip(nv.claim, 30)}`, status: "not verified — not loaded", reason: nv.why });
  for (const fl of d.failed ?? []) catalog.push({ item: `Additional research URL`, url: fl.url, status: "failed", reason: fl.reason });
}
for (const [cc, c] of Object.entries(CUR.climateProfiles)) {
  const pr = profileFor(cc, "climate-adaptation-finance");
  pr.summary = c.summary;
  pr.basis = c.basis;
  pr.offers = (c.offers ?? []).map((o) => item(o.text, o.evidence));
  pr.partners = (c.partners ?? []).map((o) => item(o.text, o.evidence));
  pr.caveats.push(...(c.caveats ?? []));
  if (c.style) pr.style = c.style;
}
// Bangladesh student stance joins its official profile as context (student, not official).
if (CUR._bdStudent) {
  const pr = profileFor("bd", "climate-adaptation-finance");
  pr.priorities.push(...CUR._bdStudent.wants.slice(0, 3).map((t) => item(`${t} (student research)`, [CUR._bdStudent.id])));
}
// Profiles: drop exact duplicate items; keep lists short.
for (const p of out.profiles) for (const k of ["priorities", "supports", "opposes", "redLines", "interests", "offers", "partners"]) {
  const seen = new Set();
  p[k] = p[k].filter((x) => !seen.has(x.text) && seen.add(x.text)).slice(0, 7);
}

// ── 5. Checks + reports ─────────────────────────────────────────────────────────────
const unused = CORR.filter((c) => !corrected.has(c.match));
if (unused.length) console.log("warning: corrections that matched nothing:", unused.map((c) => `${c.country}:${c.match}`));
for (const m of MANIFEST.filter((x) => x.kind !== "folder")) if (!catalog.some((c) => c.url && c.url === m.url)) catalog.push({ item: `Drive: ${m.path}`, url: m.url ?? "", status: "excluded", reason: CUR.otherExclusions[m.path] ?? "not used" });
const bad = out.chunks.filter((c) => !/^([a-z]{2}|intl)$/.test(c.country) || !c.agenda);
if (bad.length) throw new Error(`invalid chunks: ${bad.map((c) => c.id).join(",")}`);
out.note = `real research set: ${out.chunks.length} chunks, ${out.profiles.length} country profiles, ${out.sources.length} sources. Built ${new Date().toISOString().slice(0, 10)} from provided materials + verified additional research. See research/README.md.`;

const cov = {};
for (const c of out.chunks) {
  const k = `${c.agenda}|${c.country}`;
  cov[k] ??= { n: 0, types: new Set() };
  cov[k].n++;
  cov[k].types.add(c.sourceType);
}
const md = ["# Research coverage", "", `Set: \`${version}\` — ${out.chunks.length} chunks, ${out.profiles.length} profiles, ${out.sources.length} sources.`, ""];
for (const a of AGENDAS) {
  md.push(`## ${a.title} (\`${a.key}\`)`, "", "| country | chunks | profile | source types |", "|---|---|---|---|");
  for (const [k, v] of Object.entries(cov).filter(([k]) => k.startsWith(`${a.key}|`)).sort()) {
    const cc = k.split("|")[1];
    md.push(`| ${cc} | ${v.n} | ${out.profiles.some((p) => p.country === cc && p.agenda === a.key) ? "yes" : "—"} | ${[...v.types].join(", ")} |`);
  }
  md.push("", ...(CUR.gaps[a.key] ?? []).map((g) => `- Gap: ${g}`), "");
}
console.log(`chunks ${out.chunks.length}, profiles ${out.profiles.length}, sources ${out.sources.length}, catalog ${catalog.length}`);
for (const a of AGENDAS) console.log(`  ${a.key}: ${out.chunks.filter((c) => c.agenda === a.key).length} chunks, ${out.profiles.filter((p) => p.agenda === a.key).length} profiles`);
if (process.env.DUMP) writeFileSync(process.env.DUMP, JSON.stringify(out));
if (flag !== "--dry-run") {
  const file = path.join("data", "positions", `${version}.json`);
  if (existsSync(file)) {
    console.error(`${file} exists; versions are immutable — choose a new version name`);
    process.exit(1);
  }
  writeFileSync(file, JSON.stringify(out, null, 1));
  writeFileSync("research/catalog.json", JSON.stringify(catalog, null, 1));
  writeFileSync("research/COVERAGE.md", md.join("\n"));
  console.log(`wrote ${file}, research/catalog.json, research/COVERAGE.md`);
}
void readdirSync;
