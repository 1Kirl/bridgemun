# BridgeMUN — progress record

Last updated: 2026-11-25. Repository: github.com/1Kirl/bridgemun (private). Production: https://bridgemun.vercel.app (Firebase project `bridgemun`, Firestore asia-northeast3, Vercel region icn1).

Status legend — **real**: verified against the real external service · **mock**: verified with test doubles / emulator only · **unverified**: not yet verified.

## Phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Separation from the previous developer's environment, server auth, rules | done — local/emulator; rules deployed to `bridgemun` (real) |
| 1 | HMUN GA rules engine + automatic-chair state machine, store, scheduler interface | done — automated tests |
| 2 | Create / join by code / waiting room, atomic seats, start lock, reconnect | done — emulator + 2-browser checks |
| 3 | Meeting loop UI, timers, pause/extend, deadline recovery | done — emulator + browser; QStash deadlines on production (real) |
| 4 | Speaker recording → OpenAI transcription → confirmation → record → AI context | server path real (OpenAI); in-browser microphone capture unverified |
| 5 | OpenAI autonomous AI (floor/votes/speeches/caucus documents/sponsor), ElevenLabs TTS, position materials interface | real locally (OpenAI + ElevenLabs); production TTS storage not configured (captions only in production) |
| 6 | Documents (draft/edit/sponsor/sign), amendments, sponsor responses, final voting, results | done — engine + UI; real-AI run in progress record below |
| 7 | Real position materials | waiting for the materials file (fixture only) |
| 8 | UNSC module | planned, not available |

## App policies in force (decided 2026-11-25)
D1 procedural = majority of the electorate fixed at ballot open · D2 substantive = rule 35 with one extension · D3 carry-over with re-validation · D4 enter-voting = simple majority (rule 13 interpretation) · D5 sponsor silence → one extension → "consent not obtained" · D6 time-based end → final voting if resolutions introduced · D7 no quorum → "not held" · D9 defaults configurable, document thresholds satisfiable from 3 seats · D10 no automatic attendance; late attendance not retroactive · D11 firebase-tools 13 / Java 17.
Additional app policy (2026-11-25): after a failed transcription the speaker gets one extension to type the statement.

## How to run
- Emulator dev: `npm run emulators` + `npm run dev` (AI = dummy, speech = mock; no paid calls)
- Emulator + real AI: `AI_DRIVER=openai STT_PROVIDER=openai TTS_PROVIDER=elevenlabs npm run dev` (keys from `.env.local`)
- Real Firebase project locally: `npm run dev:project` (loads `.env.project.local`; git-ignored)
- Tests: `npm run test:emu` · Connectivity: `npm run check:project`
- Real-API verification: `node scripts/with-env.mjs .env.project.local -- npx tsx --conditions=react-server scripts/verify-real.ts <outDir>`
- QStash production smoke test: `node scripts/with-env.mjs .env.project.local -- npx tsx --conditions=react-server scripts/qstash-smoke.ts`

## Verification log
- Automated: 187 tests (engine, rules, unit, emulator store/service/Phase 4–5 with scripted LLM and mock speech).
- Real OpenAI: structured decisions (gpt-6.1-terra), speeches (gpt-6.2-sol); evidence sensitivity confirmed (France fixture flipped → vote no → yes).
- Real ElevenLabs: eleven_multilingual_v2 (~3 s for a 22 s clip) and eleven_v4 (~7 s); voice "Brian". Not yet listened to by a person.
- Real OpenAI transcription (gpt-transcribe): 100% word overlap on generated speech; route bug (".mpeg" filename) found and fixed.
- Real QStash: production tick advanced a test forum ≤7 s after its deadline (signature verified); test data deleted.
- Real-AI local meeting (emulator Firebase + real OpenAI/ElevenLabs/transcription), 2 humans (A in browser, B via API) + 3 AI:
  roll call → AI floor decisions → AI speeches with ElevenLabs audio (synced playback started without error; not listened to) →
  human speech transcribed by OpenAI (route) and auto-confirmed into AI context → unmoderated caucus where AI drafted/signed
  resolutions → introduction → AI rejected "enter voting" twice (wanted more debate) → AI moderated/unmoderated caucus motions →
  session end → D6 moved to final voting → resolution adopted Yes 3 / No 0 / Abstain 2 (AI voted clause-by-clause from materials).
  Two dev-server restarts mid-meeting recovered via client nudge (lost AI job recorded as "AI speech unavailable").
  Usage for that meeting (partial count mid-run): 36 LLM calls / 43k tokens, 3,007 TTS chars, 44 s transcription, 0 AI failures.

## Known gaps
- Zoom Video SDK keys not available → live audio/video untested; meetings work without video (text speech, uploads).
- Production TTS audio storage not configured (Firebase Storage needs a plan decision) → production shows captions only.
- AI delegations do not draft or sign amendments; division of the question / reordering not implemented.
- Vercel ↔ GitHub auto-deploy not connected (CLI deploys used); GitHub App access for the private repo is needed.
