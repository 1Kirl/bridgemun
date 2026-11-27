# BridgeMUN — progress record

Last updated: 2026-11-27 (meeting UX: W1 response waits + visual room). Repository: github.com/1Kirl/bridgemun (private, branch `main`).
Production: https://bridgemun.vercel.app — Vercel project `1kirl/bridgemun` (Git-connected, production branch `main`,
auto-deploy on push, region icn1) · Firebase project `bridgemun` (Firestore asia-northeast3).

Status legend — **real**: verified against the real external service · **mock**: verified with test doubles / emulator only · **unverified**: not yet verified.

## Phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Separation from the previous developer's environment, server auth, rules | done; rules/indexes deployed to `bridgemun` (real) |
| 1 | HMUN GA rules engine + automatic-chair state machine | done — automated tests |
| 2 | Create / join by code / waiting room, atomic seats, start lock, reconnect | done — production API (real) + emulator browser |
| 3 | Meeting loop, timers, pause/extend, deadlines via QStash, recovery | done — production (real): QStash-only deadlines, duplicates, pause, idle hold |
| 4 | Speaker recording → OpenAI transcription → confirmation → record → AI context | server path real; in-browser microphone capture unverified (needs a real browser + mic) |
| 5 | OpenAI autonomous AI, ElevenLabs TTS, position materials interface | production AI real; TTS real locally only (production = captions, see docs/production-audio.md) |
| 6 | Documents, amendments (incl. AI), sponsor responses, voting procedure (reorder, division), final voting, results | done — engine + UI; production E2E (real) |
| 7 | Real position materials | waiting for the materials file (fixture only; see docs/position-materials.md) |
| 8 | UNSC module | planned, not available |

## App policies in force
D1 procedural = majority of the electorate fixed at ballot open · D2 substantive = rule 35 with one extension · D3 carry-over with re-validation · D4 enter-voting = simple majority (rule 13 interpretation) · D5 sponsor silence → one extension → "consent not obtained" (distinct from "objected") · D6 time-based end → final voting if resolutions introduced · D7 no quorum → "not held" · D9 defaults configurable, document thresholds satisfiable from 3 seats · D10 no automatic attendance · D11 firebase-tools 13 / Java 17.
Added: one extension after a failed transcription · **H1** (stop work when every human has left): a deadline passing with no human online puts the forum on hold (no AI calls, one scheduled check); a reconnect resumes it (5 s grace); after `idleHoldMaxSec` (600 s) it closes ("all_humans_left").
**W1** (2026-11-27, online operating policy — not an HMUN rule): every step that needs specific humans waits for them up to `responseWaitSec` (300 s) from the request, closes as soon as they and the AI are done, and on expiry applies a stated default (not voting ≠ abstain; no attendance chosen; no motion; consent not obtained ≠ objection; turn ended). Time held past a step's normal timer is added back to the session end. H1 takes precedence. Revised 2026-11-27: connection never shortens a window (offline delegates keep their deadline while anyone is online); a delegate's "no motion" stands across unchanged floor windows (the window still runs its normal time); caucus "pass this turn only" vs "pass for the rest of this caucus". Full table: docs/response-wait-policy.md. Start briefing (12 s, server-timed) before roll call; the session clock starts at roll call. Forums created before W1 keep the old timers.
Rule interpretations added: rule 33 proposals ordered "more parts = more disruptive", ties by submission; division applies to resolutions; reorder is taken before the first resolution is voted; a stale amendment (resolution text changed since drafting) cannot be introduced (app policy).

## Procedure coverage (engine vs. usable UI)

| Feature | Engine | UI end-to-end | Production verified |
|---|---|---|---|
| Speakers' list, speeches, text speech, transcript confirmation | yes | yes | yes (text speech) |
| Yield to another delegate (rule 18); receiver cannot yield again | yes | yes (end-speech selector) | local UI + engine tests |
| Yield to questions (rule 18) | no (moderator selection of questioners) | not shown | — |
| Point of personal privilege (rule 20) → recorded notice | yes | yes (Points panel) | engine tests, UI rendered |
| Points of order / parliamentary inquiry (rules 21–22) | answered by engine validation messages + phase description | Points panel (information) | — |
| Motions: caucuses, extension, speaking time, suspend, adjourn, introduce resolution/amendment, enter voting | yes | yes | yes |
| AI amendments: propose / sign / introduce / sponsor responses | yes | — (AI) | yes |
| Friendly vs "objected" vs "consent not obtained" | yes | yes (labels) | objected + all_agreed real; silence path engine/emulator |
| Unfriendly amendment 2/3 vote and application to text | yes | yes | yes (a21 adopted 4-0-1 → d10 v2) |
| Reorder resolutions (rule 34) | yes | yes | yes |
| Division of the question (rule 33): motion, proposals, part votes, recombination, "rejected as a whole" | yes | yes | yes (recombined v2 adopted) |
| Text version locking (ballot carries version + textHash) | yes | yes ("text locked") | yes |
| Results screen (per-item tallies, votes by country) | yes | yes | local UI |
| Roll-call votes, right of reply, suspension of rules, crisis rules 37–40 | excluded | — | — |

## Meeting room UI (2026-11-27)
Stage track (Roll call → Debate & negotiation [loop: general debate / moderated caucus / negotiation & drafting / resolutions, switched by motion] → Final voting → Results; no percentages) · situation card (actor flag, human/AI, action, large server-time countdown, continue condition, details folded) · "my action" card (response needed / done / no action, response countdown, 60 s and 15 s warnings stating the real consequence) · human response tracker (who responded, never how) · general speakers' list with "paused — resumes after the caucus" and separate caucus volunteers · seat grid · vote charts (live: votes-cast progress only; closed: Yes/No/Abstain/Not voted bars, pass line on the correct denominator: electorate for procedural D1, Yes+No for substantive rule 35) · resolution pipeline with signature meters · final results cards · lobby "Based on HMUN 2026" badge with rule-by-rule details · opening briefing overlay (reduced-motion aware).

## How to run
- Emulator dev: `npm run emulators` + `npm run dev` (AI = dummy, speech = mock; no paid calls)
- Emulator + real AI: `AI_DRIVER=openai STT_PROVIDER=openai TTS_PROVIDER=elevenlabs POSITION_SET_VERSION=fixture-v0 npm run dev`
- Real Firebase project locally: `npm run dev:project` (loads `.env.project.local`; git-ignored)
- Tests: `npm run test:emu` (238) · Connectivity: `npm run check:project`
- Production E2E driver (admin-created test users, public API routes, no passwords):
  `node scripts/with-env.mjs .env.project.local -- node scripts/e2e/prod-drive.mjs <users|create|lookup|join|cmd|presence|heartbeat|state|wait|vote|record|ai|usage|forumdoc|use>`
  (state in `.data/prod-e2e*.json`, git-ignored). Duplicate QStash deliveries: `scripts/e2e/dup-ticks.mjs`.
- QStash smoke test: `node scripts/with-env.mjs .env.project.local -- npx tsx --conditions=react-server scripts/qstash-smoke.ts`

## Verification log
### Production (real; https://bridgemun.vercel.app)
- Auto-deploy: pushes to `main` deploy via the Vercel GitHub integration (commit status "Vercel: success"), e.g. e97e4c6, d0b8d2c, ecfd544.
  Env change `POSITION_SET_VERSION=fixture-v0` needed a redeploy (forum created before it pinned "none").
- Test users `audit-test-a` / `audit-test-b` (Admin SDK, no password; custom-token sign-in). Forums titled "AUDIT TEST — production E2E 1–4", all CLOSED.
- E2E 3 (KcctAC4b8OuMRouQCkp2, commits d386c2c→d0b8d2c): create (country us) → code lookup/join (gb) → start → join of a non-member blocked (E2E 2: forum_started / join_locked) → reconnect returns own seat →
  human text speech → France AI speech responding to it → human motion voted by AI (each on own materials) → caucuses (AI drafts/signs; **defect found & fixed**: AI ignored drafts shared mid-caucus) →
  AI amendment proposals and signatures; Japan (AI) moved to introduce a human amendment → friendly (all AI sponsors agreed) and unfriendly ("a sponsor objected") →
  owner pause/resume with a QStash tick inside the pause (ignored) → 5 duplicate QStash deliveries → exactly one transition →
  enter voting → reorder (**defect found & fixed**: motion text lacked the order) → divide → proposal failed → resolution adopted; unfriendly amendment adopted 2/3; final vote hit OpenAI 503 (**fixed**: one retry for transient errors) → AI recorded as not voting, meeting completed.
- E2E 4 (7gRDo1a1jhIQorv6YvH0, commit ecfd544): three resolutions; both humans offline → idle hold (no AI calls) → reconnect resumed; reorder adopted with AI support (France/Japan proposed the same order);
  AI-proposed division of the compulsory-licensing clause → part 1 included, part 2 excluded → recombined v2 adopted 4-0-1; forced AI failure (forum AI budget filled) → AI did not vote, humans decided, forum closed.
- E2E 1 / E2E 2: no heartbeats at all → idle hold at the QStash deadline → closed after 10 min ("all_humans_left") without any client.
- After close: stale QStash ticks change nothing; AI action counts stay constant.
- All deadlines in E2E 3–4 came from QStash (scripts sent presence heartbeats only, never nudges).
- Production usage (2026-11-25 UTC day counter): 95 LLM calls, ~116k tokens (E2E 3: 62 calls / 79k; E2E 4: 33 calls / 36k). TTS/STT: none in production.
- W1 production check (2026-11-27, forum p8KKydoKPHrTZczKn3UL "AUDIT TEST — W1 production check", commit 356c95d, real OpenAI AI, QStash only):
  start → BRIEFING → roll call after 13 s; UK silent → held past the 60 s timer (`holding`, deadline = request + 300 s); UK declared → floor at once;
  floor closed as soon as both humans and the AI responded; motion vote: US + 3 AI voted, UK silent → held past the 30 s timer; 5 duplicate QStash
  deliveries + the original → exactly one transition; at 5 min UK recorded "did not vote" (not abstain), motion adopted 4-0 [yes > eligible/2], amber
  record entry; session end extended by the held time only (279.6 s = 8 s + 270 s). Both users offline → H1 idle hold (no AI calls) → closed after 10 min.
- W1 revision production check (2026-11-27, forum ah8O1sGL6bgtzIIiHkiu "AUDIT TEST — W1 revision check", commit 50bf29a, real AI, QStash only, 2 test humans):
  UK offline while awaited on the floor → still held 50+ s past the step timer to the ORIGINAL deadline (no "not awaited"); reconnect → same deadline (210 s left), response accepted, meeting moved on at once;
  both humans said "no motion" and nothing changed → later windows had standing ["us","gb"], nobody asked again, each ran its normal 30 s; an AI motion → vote;
  UK offline for the whole vote → full 5 min, then "did not vote" (offline), 4-0 adopted; 5 duplicate QStash deliveries → one transition; credit 331 s (61 s + 270 s);
  both offline → H1 idle hold at the caucus end (no AI calls: 23 AI actions / 21 LLM calls / ~19k tokens before and after) → closed "all_humans_left" after 10 min.
- Local browser (W1 revision, 2026-11-27): "no motion stands" card (standing state injected into the emulator for the rendering check — the dummy AI always joins the speakers' list),
  offline delegate shown as awaiting + offline, hold confirmed in the running engine, reconnect kept the deadline; caucus "Pass this turn only" / "Pass for the rest of this caucus" / "Ask me every turn again". Screenshots: /Users/kirl/BridgeMUN/screenshots/2026-11-27-w1-rev/.
### User-verified on the production site (real browsers, 2026-11-27, new forum after 50bf29a)
- Roll call: only US declared → waited for UK; UK declared → next step at once. (user check: passed)
- Motion floor: UK tab closed while awaited → the wait continued; after reconnecting the response deadline was not reset. (user check: passed)
### Local real browser (emulator Firebase, dummy AI) — 2026-11-27 W1 UI
- Browser user (US, owner) + API users (UK, France) + 4 AI; second browser origin signed in as UK for side-by-side checks. Screenshots: /Users/kirl/BridgeMUN/screenshots/2026-11-27-w1/.
- Lobby badge; briefing (cards, refresh resumes mid-animation, 5 s countdown); roll call held for the last human and advancing on their click; refresh did not reset the window;
  vote where all 4 AI and 2 of 3 humans had voted waited for the last human (6/7; the 10 AI + 3 humans case is an engine test); 60 s and 15 s warnings; expiry → not voting; result chart with pass line; caucus list "paused — resumes after";
  moderated caucus Volunteer / Not this round; resolution pipeline; final voting; results cards; Start speech → 45 s speaking time; mobile (375 px) and desktop; two users saw the same stage and countdown.
### Local real APIs (emulator Firebase)
- Earlier full real-AI meeting (see git history of this file): adopted 3-0-2; restarts recovered; 36 LLM calls / 43k tokens, 3,007 TTS chars, 44 s STT.
- This session: browser UI as user A (emulator account) + API user B with real OpenAI/ElevenLabs: yield to Japan (AI) → ElevenLabs speech played in sync (joined at +11.96 s, playing, 22 s clip); reorder, division proposals (checkbox UI), part votes, locked-text final vote and results screen rendered.
- Voice samples for listening: `/Users/kirl/BridgeMUN/audio-samples/` (13 pool voices, eleven_multilingual_v2, same sentence; plus the earlier Brian samples for eleven_multilingual_v2 and eleven_v4; index in `samples.json`). **Not listened to by a person.**
### Automated
- 238 tests (W1 revision: +10 — offline keeps the deadline, reconnect keeps remaining time and the right to respond, offline expiry, offline voter keeps the vote window, H1 hold/close, standing no-motion incl. motion still possible and re-asking after a change, caucus pass scopes). Before: 228 tests (2026-11-27: +22 engine W1 tests with a controlled clock — 10 AI + 3 humans wait, early close, expiry ≠ abstain, AI do not hold past the timer, duplicate/racing ticks, floor "no motion", unrelated actions do not count, refresh/offline grace, H1 precedence, start speech vs speaking time, list kept through caucus, volunteer/pass, roll call no attendance chosen, sponsor consent not obtained, session credit once; +1 emulator test for W1 defaults/briefing).
- Earlier: 205 tests (engine incl. reorder/division/yield/points/H1/stale ticks; rules; unit incl. transient-retry classification; emulator store/service/Phase 4–6 with scripted LLM incl. AI amendments, AI division, 503 retry, Firestore audio store).

## Known gaps / decisions waiting
- Zoom Video SDK keys not available → live audio/video untested; "Zoom keys missing" notice and token tests exist.
- Production TTS storage: options and costs in docs/production-audio.md; opt-in Firestore store implemented but **off**.
- Browser sign-up/login on the production site not exercised by the agent (no password entry into non-local sites); API-level production test used admin-created users.
- Microphone capture in a real browser, two physical devices, listening to voices: user checks.
- Yield to questions, roll-call votes, right of reply: not implemented (excluded or need moderator discretion).
- Audio cleanup after forum end (Firestore store) not automated; AI job interruption by a killed function verified locally only (production recovery relies on the same engine deadlines).
- UNSC: not started.
