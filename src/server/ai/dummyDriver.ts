import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { stableHash } from "@/engine/documents";
import type { Effect, ForumEngineState } from "@/engine/types";
import { loadState, runCommand, type EffectSink } from "@/server/engine/store";

/**
 * DUMMY AI DRIVER — Phase 3 test double. NOT OpenAI.
 * Deterministic, rule-based behaviour so the meeting loop can run with AI seats before the real
 * orchestrator (Phase 5) exists. Every text it produces is prefixed "[DUMMY AI]".
 * It sends commands through the SAME engine path as humans (same validation, same ballots).
 */
export const DUMMY_PREFIX = "[DUMMY AI — not OpenAI]";

const h = (s: string) => parseInt(stableHash(s).slice(0, 8), 16);

export function dummyVote(seat: string, ballotId: string, allowAbstain: boolean): "yes" | "no" | "abstain" {
  const r = h(`${seat}:${ballotId}`) % (allowAbstain ? 5 : 4);
  return r === 4 ? "abstain" : r === 3 ? "no" : "yes"; // ~60–75% yes, deterministic per seat+ballot
}

export function createDummyAiDriver(db: Firestore, getSink: () => EffectSink, delayMs = 400) {
  // All AI actions of one forum run one at a time: they write the same state document, and parallel
  // transactions would only contend and retry.
  const queues = new Map<string, Promise<unknown>>();
  let currentForum = "";
  const later = (fn: () => Promise<unknown>, extra = 0) => {
    const forumId = currentForum;
    setTimeout(() => {
      const prev = queues.get(forumId) ?? Promise.resolve();
      const next = prev.then(fn).catch((e) => console.error("[dummy-ai]", e));
      queues.set(forumId, next);
    }, delayMs + extra);
  };

  const act = (forumId: string, seat: string, command: Parameters<typeof runCommand>[2]["command"], expect?: Parameters<typeof runCommand>[2]["expect"]) =>
    runCommand(db, forumId, { actor: { kind: "ai", seat }, command, expect }, { onEffects: getSink() });

  return async function handle(forumId: string, effects: Effect[]) {
    currentForum = forumId;
    for (const e of effects) {
      switch (e.type) {
        case "ai_attendance_needed":
          for (const seat of e.seats) later(() => act(forumId, seat, { type: "declare_attendance", seat, value: "present" }));
          break;
        case "ai_floor_decision_needed":
          later(async () => {
            const s = await loadState(db, forumId);
            if (!s || s.phase.type !== "FLOOR_OPEN" || s.phase.windowId !== e.windowId) return;
            const ai = aiPresent(s);
            if (ai.length) {
              // One AI per window asks for the floor; every 4th window one AI moves a short moderated caucus.
              const pick = ai[h(e.windowId) % ai.length];
              if (!s.speakersList.includes(pick)) await act(forumId, pick, { type: "add_to_speakers_list", seat: pick });
              if (h(`${e.windowId}:m`) % 4 === 0 && !s.debateClosed) {
                await act(forumId, pick, {
                  type: "submit_motion",
                  seat: pick,
                  params: { type: "mod_caucus", topic: `${DUMMY_PREFIX} key concerns`, speakingSec: 45, totalSec: 180 },
                });
              }
            }
            for (const seat of ai) await act(forumId, seat, { type: "floor_pass", seat }, { phaseId: e.windowId });
          });
          break;
        case "ai_vote_needed":
          for (const seat of e.seats) {
            later(async () => {
              const s = await loadState(db, forumId);
              const b = s?.ballots[e.ballotId];
              if (!b || b.status !== "open") return;
              const allowAbstain = b.kind === "substantive" && b.eligible[seat]?.attendance === "present";
              await act(forumId, seat, { type: "cast_vote", seat, ballotId: e.ballotId, choice: dummyVote(seat, e.ballotId, allowAbstain) }, { ballotId: e.ballotId });
            }, h(seat) % 1500);
          }
          break;
        case "ai_speech_needed":
          later(async () => {
            const s = await loadState(db, forumId);
            const name = s?.seats[e.seat]?.countryName ?? e.seat;
            const text = `${DUMMY_PREFIX} The delegation of ${name} takes the floor (context #${e.contextSeq}). This placeholder speech stands in for an AI-generated statement.`;
            await act(forumId, e.seat, { type: "ai_speech_ready", seat: e.seat, text, contextSeq: e.contextSeq });
          });
          break;
        case "ai_volunteer_needed":
          later(async () => {
            const s = await loadState(db, forumId);
            if (!s || s.phaseId !== e.phaseId || !s.activeCaucus) return;
            const fresh = e.seats.filter((x) => !s.activeCaucus!.spokenSeats.includes(x));
            if (!fresh.length) return; // dummy AIs speak at most once per caucus
            const pick = fresh[h(e.phaseId) % fresh.length];
            await act(forumId, pick, { type: "volunteer", seat: pick }, { phaseId: e.phaseId });
          });
          break;
        case "ai_caucus_work_needed":
          // Dummy: every AI signs (as signatory) each open draft it is not already on.
          later(async () => {
            const s = await loadState(db, forumId);
            if (!s || s.phaseId !== e.phaseId) return;
            for (const d of Object.values(s.documents)) {
              if (d.status !== "draft" && d.status !== "approved") continue;
              for (const seat of e.seats) {
                if (!d.sponsors.includes(seat) && !d.signatories.includes(seat)) {
                  await act(forumId, seat, { type: "sign_document", seat, docId: d.id, role: "signatory" });
                }
              }
            }
          }, 3000);
          break;
        case "ai_sponsor_response_needed":
          for (const seat of e.seats) later(() => act(forumId, seat, { type: "sponsor_response", seat, amendmentId: e.amendmentId, agree: true }));
          break;
        default:
          break;
      }
    }
  };
}

function aiPresent(s: ForumEngineState) {
  return Object.values(s.seats)
    .filter((x) => x.kind === "ai" && (x.attendance === "present" || x.attendance === "present_and_voting"))
    .map((x) => x.id);
}
