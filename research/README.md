# Research materials for AI delegations

AI delegations argue from a **versioned research set** (`data/positions/<version>.json`). A forum pins the set
version that is configured when it is created (`POSITION_SET_VERSION`), so a running meeting never changes
evidence mid-session. `fixture-v0` is invented test data used by the emulator; `real-*` sets are real research.

## What is in a set

| field | meaning |
|---|---|
| `chunks` | short pieces of evidence, each for ONE country (or `intl` = common background) and one agenda |
| `profiles` | a country's identity on an agenda: priorities, supports, opposes, red lines, stakes, offers, issue-specific partners, style, caveats — every item lists the chunk ids it rests on |
| `sources` | document list (title, URL, publisher, date, type, verification) used for citations |
| `agendas` | agenda keys with English keywords (Korean agenda text is mapped to these terms at match time) |

Every chunk is labelled:

- **sourceType** — `official_position` (government/ministry/official statement or submission), `negotiation_record`
  (what a country said, as recorded e.g. by the Earth Negotiations Bulletin; group statements are labelled as
  group positions), `national_context` (facts, not a stated policy), `team_research` / `student_summary`
  (student/team-compiled), `intl_background` (UN/treaty text shared by all), `research` (study findings — never
  treated as a government's policy), `simulation_assumption`.
- **verification** — `verified` (checked in the original), `partly` (checked; details differ or corrected),
  `unverified` (not checked: the AI must hedge). Contradicted claims are corrected in `research/curated.json` or
  dropped; they are never loaded.

Retrieval (`src/server/positions/positions.ts`): country first (another country's material is never used), then
agenda; ranked by the current motion / clause / caucus topic / recent record, weighted by source type and
verification. Common background (max 2) is shown separately as "not any country's position". The model may cite
only ids it was shown; cited ids are logged with title and link for "Why did the AI do that?".

Procedure, voting-right, observer and "ground truth" settings that appear in source files are **not** loaded —
the meeting engine (rules `hmun-ga-2026@1`) alone decides seats, attendance, votes and procedure.

## Files

- `research/curated.json` — hand-written summaries, corrections (from the fact check), exclusions, climate
  identity notes, coverage gaps. Edit this to change what is loaded.
- `research/additional/*.json` — verified additional research (official documents opened and checked; quotes
  ≤ 40 words; points in our own words): `climate-donors.json`, `climate-recipients.json`, `verification.json`
  (fact check of the provided team/student material).
- `research/catalog.json` — every provided item and URL: used / excluded / duplicate / failed, with reasons.
- `research/COVERAGE.md` — agenda × country coverage and known gaps.
- Originals (Google Docs / Drive files) are downloaded to `.data/research/raw/` (git-ignored) and are not
  republished; the repository is public, so only short excerpts, own-words summaries and links are committed.

## Adding or updating material

```bash
python3 scripts/research/fetch_provided.py            # 1. re-download the shared Docs/Drive folders (read-only)
# 2. add verified documents to research/additional/<topic>.json (same shape as the existing files),
#    or summaries/corrections to research/curated.json
node scripts/research/build-set.mjs real-YYYY-MM-DD   # 3. build a NEW version (existing versions are immutable)
npx vitest run tests/unit/research-set.test.ts         # 4. update the test's version name and check
vercel env add POSITION_SET_VERSION production --force # 5. set the new version (then redeploy)
```

New forums use the new version; forums created earlier keep theirs. No admin screen or approval step is involved.
