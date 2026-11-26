# App policy W1 — waiting for required human responses

BridgeMUN online operating policy (2026-11-27). **Not an HMUN rule.** The HMUN 2026 rules (`hmun-ga-2026@1`) are
unchanged; W1 only decides how long the automatic chair waits for people before a step continues, and what
happens if they do not answer. Code: `src/engine/responses.ts` (who is awaited, shared by engine and UI) and
`src/engine/machine.ts` (`waitGate`, `maybeAdvanceOnResponse`, `holdCreditMs`). Tests:
`src/engine/__tests__/response-wait.test.ts` (controlled clock).

## How a step ends

1. When a step that needs human responses starts, a **response window** opens: `responseWaitSec` (default 300 s)
   from the moment the response is requested (for votes: when voting opens after the reading time).
2. The step's **normal timer** (motion window 45 s, voting 45 s, volunteer window 15 s, …) still runs; it is the
   time the AI delegations get. AI never close a step early on their own.
3. The step continues **as soon as** every required human has responded **and** the AI are done (or the normal
   timer has run out). Nobody waits for the full timer when everyone has answered.
4. If a required human who is **online** has not answered when the normal timer runs out, the step is **held**
   until they answer or the response window ends. Clicks, scrolling, heartbeats and refreshes are not responses
   and do not reset the window (the deadline is a fixed server time).
5. When the window ends, the step's default below is applied, written to the record (amber "automatic step"
   entry with the time), and the step's normal transition rules (quorum etc.) are evaluated again.
6. A required human who is **offline** is not awaited past the normal timer (noted in the record as "offline —
   not awaited"). If someone drops out during a hold and nobody else online is awaited, they get a 20 s grace to
   return; a quick refresh therefore does not skip anyone.
7. **Precedence:** app policy H1 comes first. If no human is online at all when a timer fires, the forum goes on
   idle hold (no AI calls); the response window is frozen during the hold and shifted, not reset, on reconnect.
   After 10 min without anyone, the forum closes ("all_humans_left").

## Who must respond, what counts, what happens on expiry

| Step | Required (humans only) | Completes the response | On expiry (5 min) |
|---|---|---|---|
| Roll call | every human delegate | Present / Present and voting | stays "not recorded" (no attendance chosen); debate opens if the quorum (rule 32) is met, otherwise roll call stays open until session end |
| Recognised speaker (prep) | that speaker only | **Start speech** | turn ends without a speech, recorded as no response; next speaker or floor |
| Speech | — (speaking time runs, not the window) | End speech / text speech | normal speaking time applies |
| Transcript confirmation | that speaker only | Confirm / type text / skip | automatic transcript entered if ready, else "no transcript" |
| Floor open for motions | present humans | submit a motion **or** "No motion — I'm done" | treated as no motion |
| Motion / substantive vote (voting stage) | humans eligible for that ballot (electorate fixed at opening) | cast a vote | recorded as **not voting** — never yes/no/abstain |
| Moderated caucus volunteering | present humans | Volunteer **or** "Not this round" | treated as not volunteering |
| Amendment sponsor response | human sponsors of the target resolution | Accept / Object | friendly consent **not obtained** (distinct from an objection) → 2/3 vote |
| Voting procedure motions (reorder / divide) | present humans | submit **or** "No motion — I'm done" | treated as no motion |
| Division proposals | present humans | submit a proposal **or** "No proposal — I'm done" | treated as no proposal |
| Unmoderated caucus (negotiation) | — (informational: "Ready to resume") | Ready to resume | caucus ends at the length adopted by motion (no extra hold) |
| Reading time, AI speech, DR presentation/Q&A, suspension | nobody | — | normal timer |

Actions in one step never complete another step's response (e.g. joining the speakers' list does not answer a
floor window; a vote does not answer a later floor window).

## Time budget

* Time a step is **held past its normal timer** for humans is added back to the session end
  (`usage.responseWaitCreditMs`), so a 30-minute forum keeps its 30 minutes of debate. Responding early adds nothing.
* The credit is wall-clock time of the hold — waiting for three people at once is counted once, not three times.
* Cap: at most one extra session length in total (prevents an endless meeting).
* Speaking time, caucus length (as adopted by motion) and the session-end rule D6 are unchanged.
* The +30 s extension buttons are not used in W1 forums (the response window replaces them).

## Duplicates and races

The engine is a single serialized reducer: duplicate or early scheduler ticks are no-ops; a response that
arrives at the deadline instant before the tick is counted and the late tick is rejected as stale; votes after a
ballot closed are refused. Each step's responses are stored on that step only.

## Start briefing

`briefingSec` (12 s): after "Start forum" every member sees the same briefing (driven by the server start time;
a refresh resumes at the same point and nothing is shown once roll call has begun). The session clock starts
when roll call opens.

## Older forums

Forums created before W1 (`responseWaitSec` absent) keep the previous short timers and behaviour.
