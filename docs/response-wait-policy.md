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
6. **Connection does not shorten the window** (revised 2026-11-27): while at least one human is online, a required
   human who is offline is awaited until their original response deadline, exactly like an online one. A refresh or
   reconnect restores the same remaining time (the deadline never moves) and they can respond as before. The UI
   shows "offline" separately from "awaiting response". (The first W1 version skipped offline delegates after the
   normal timer / a 20 s grace — removed.)
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
| Floor open for motions | present humans | submit a motion **or** "No motion — I'm done" (stands while nothing changes, see below) | treated as no motion |
| Motion / substantive vote (voting stage) | humans eligible for that ballot (electorate fixed at opening) | cast a vote | recorded as **not voting** — never yes/no/abstain |
| Moderated caucus volunteering | present humans | Volunteer **or** "Pass this turn only" **or** "Pass for the rest of this caucus" | treated as not volunteering this turn |
| Amendment sponsor response | human sponsors of the target resolution | Accept / Object | friendly consent **not obtained** (distinct from an objection) → 2/3 vote |
| Voting procedure motions (reorder / divide) | present humans | submit **or** "No motion — I'm done" | treated as no motion |
| Division proposals | present humans | submit a proposal **or** "No proposal — I'm done" | treated as no proposal |
| Unmoderated caucus (negotiation) | — (informational: "Ready to resume") | Ready to resume | caucus ends at the length adopted by motion (no extra hold) |
| Reading time, AI speech, DR presentation/Q&A, suspension | nobody | — | normal timer |

## No repeated confirmations

* **Standing "no motion".** A delegate's explicit "No motion — I'm done" stands for later floor windows as long as
  nothing meaningful has changed: no new confirmed statement, no change to the speakers' list, to any document's
  status/version, to any amendment's status, or to the speaking time. Such a window does not ask them again
  ("no motion stands"), but it still stays open for its normal timer so they can move a motion at any time.
  Moving a motion makes them "active" again (asked normally next time). Any meaningful change asks everyone again.
  A new motion is always voted, and every eligible human is asked to vote on it.
* **Caucus volunteering (revised 2026-11-27).** Only two answers: "Volunteer to speak" or "Pass this turn". A pass
  applies to the current speaking turn; every new turn asks again. The earlier "pass for the rest of this caucus" /
  "ask me every turn again" options were removed; the server refuses them. A persistent pass stored by the earlier
  version still counts for the turn in which it was given and is cleared when the next turn opens. Nobody is ever
  excluded from speaking, and no answer is made up for anyone.
* **No instant floor loop (2026-11-27 incident fix).** If no human is required in a floor-type window (e.g. no human
  declared attendance), the window is never closed early by AI passes; it runs its normal timer. When a floor window
  opens in exactly the same situation as the previous one, the AI is consulted only on every 4th such window.

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

`briefingSec` (30 s for new forums; was 12 s): after "Start forum" every member sees the same briefing (driven by the server start time;
a refresh resumes at the same point and nothing is shown once roll call has begun). The session clock starts
when roll call opens.

## Older forums

Forums created before W1 (`responseWaitSec` absent) keep the previous short timers and behaviour.

## Timer display (2026-11-27 revision)

* Steps that await humans show their **normal time** as the main countdown (e.g. "Voting time 0:45";
  reading time and voting time are labelled separately).
* When that time is over and humans are still awaited, the number disappears: "Waiting for human responses ·
  N human response(s) remaining". The internal deadline (requested + 300 s — NOT 45 s + 300 s) is never shown as a
  running countdown anywhere.
* 60 s before the internal deadline: amber notice; 15 s before: red notice (fixed text, no countdown; votes:
  "1 minute left to vote. If you do not respond, you will be recorded as not voting." / "15 seconds left to vote. …").
  The notice disappears as soon as the user responds; after a reconnect the notice matching the current time is shown.

# App policy S1 — human speaking time up to 300 s

BridgeMUN online operating policy, **not an HMUN rule** (official speaking time: rule 17, 60 s by default).

* Applies to human speeches on the general speakers' list and in moderated caucuses (new forums:
  `timers.humanSpeechMaxSec = 300`). AI speeches keep the official speaking time. Yielded time (rule 18) stays the
  remaining **official** time.
* Flow: recognised → preparation (choose microphone or text, check microphone permission, write a draft — none of
  this uses speaking time) → **Start speech** → up to 300 s.
* Ends at once on End speech (microphone → recording stops → transcript confirmation step), on a successful
  text submission (enters the record directly), or automatically at 300 s (microphone audio actually recorded is
  transcribed; an unsubmitted text draft is never submitted for the delegate). End / submit / expiry racing: the
  engine ends the turn exactly once; later requests are refused as stale.
* Time accounting: the moderated caucus still counts the official caucus speaking time per speech (rule 10), so a long
  human speech never cuts the caucus. Only the time actually used beyond the official speaking time is added back to the
  session end (`usage.speechOvertimeCreditMs`), separately from the W1 credit and **not** subject to the W1 cap.
  App pause time is excluded. A session end is only applied at step boundaries, so a speech is never cut by it.
* Maximum meeting length (policy): planned duration + W1 waiting credit (capped at one more planned duration) +
  S1 overtime actually used (per human speech at most 300 s minus THAT slot's official speaking time — e.g. 240 s for
  a 60 s slot, 255 s for a 45 s slot; computed from each slot's `officialSec`, no fixed value) + app pauses (≤ 15 min total) +
  an H1 idle hold (closes after 10 min).

## Scope

New forums created after this deploy get W1 (300 s), the briefing and S1. Forums created earlier keep the settings they
were created with; running timers are never reset.
