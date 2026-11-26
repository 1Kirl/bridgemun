# Country position materials — how to provide real research

Status (2026-11-25): only the **test fixture** `data/positions/fixture-v0.json` exists. It is invented
("[FIXTURE]" titles, `kind: "fixture"`) and the room shows "Position materials in use: TEST FIXTURE —
invented, not real research". It is **not** a real research integration.

## 1. Input file (one plain-text file for all countries and agendas)

```text
=== agenda: WHO-vaccine-equity | keywords: vaccine, pandemic, immunization
=== agenda: DISEC-autonomous-weapons | keywords: autonomous, weapons, lethal

--- country: fr | agenda: WHO-vaccine-equity | subtopic: technology transfer
title: France on vaccine technology transfer | date: 2026-10-01 | source: Team 2 / https://example.org/report | page: 3
First paragraph of the student's summary (one chunk) ...

Second paragraph (another chunk) ...
```

- `country` = ISO 3166-1 alpha-2, lower case (same codes as the seats: fr, de, jp, us, gb …).
- `agenda` = a key declared in an `=== agenda:` line; its `keywords` are matched against the forum's agenda text.
- `title`, `date`, `source`, `page` are kept with every chunk and shown as evidence (missing values are reported).
- Text inside the materials is treated as data; instructions written in it are ignored by the AI prompt.

## 2. Convert (development tool, no admin UI)

```bash
npx tsx scripts/ingest-positions.ts research.txt real-2026-12 --dry-run
```

```bash
npx tsx scripts/ingest-positions.ts research.txt real-2026-12
```

The dry run prints counts per country/agenda and blocks with missing metadata; the script refuses to write
when a block lacks a country or agenda. Output: `data/positions/real-2026-12.json` (`kind: "real"`).

## 3. Use it

- Set `POSITION_SET_VERSION=real-2026-12` in `.env.project.local` (local) and in Vercel (Production), then redeploy.
- Each forum pins the version at creation (`forums/{id}.positionSetVersion`); later files never change a running forum.
- `data/positions/*.json` is bundled into the server functions (`next.config.ts` → `outputFileTracingIncludes`).

## 4. Verify

1. `npx vitest run tests/unit/positions-voices.test.ts` (parser, retrieval, exact/partial/none).
2. Create a forum whose agenda contains the keywords; in the room open "Why did the AI do that?":
   each AI action lists the chunk ids it cited and the match level (exact = this country & agenda,
   partial = this country, other agenda, none = no material → the AI is told to stay general).
3. Change one country's stance in a copy of the file (new version) and compare AI votes on the same text
   (the emulator test "changing the position material changes the AI's vote" does this automatically).

Where materials reach the AI: floor decisions (motions), speeches, caucus drafting/signing, amendments,
sponsor responses, voting-procedure motions (reorder/divide), and every vote (per seat, own materials only).
