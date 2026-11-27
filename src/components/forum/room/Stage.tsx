"use client";

import { Bot, ChevronDown, Gavel, Mic } from "lucide-react";
import type { PublicForumState } from "@/engine/publicView";
import type { ResponseView } from "@/engine/responses";
import { describePhase } from "@/lib/phaseText";
import { subStateOf, timerOf } from "@/lib/meetingFlow";
import { BallotSubject } from "./Panels";
import { ACTION_LABEL, Countdown, Flag, KindBadge, Spinner, VoteChart, WaitingBadge } from "./Visuals";

/** Shared height for the two top cards so they line up and never push the Record down when content changes. */
export const STAGE_H = "lg:h-[340px]";

/**
 * Left: the automatic chair. A fixed space whose content changes with the step (chair notice, motion being read,
 * the vote in progress, waiting for people). Long content scrolls inside.
 */
export function ChairPanel({ state, rv, now }: { state: PublicForumState; rv: ResponseView | null; now: number }) {
  const p = state.phase;
  const t = timerOf(state, rv, now);
  const d = describePhase(state);
  const ballot = (p.type === "MOTION_VOTE" || p.type === "VOTING_PROCEDURE") && p.ballotId ? state.ballots[p.ballotId] : null;
  const pending = rv && rv.holds ? rv.pending.length : 0;
  const condition =
    rv && rv.holds && rv.required.length > 0
      ? pending > 0
        ? `Continues when ${pending} more human delegate${pending > 1 ? "s" : ""} respond${pending > 1 ? "" : "s"}.`
        : "All human responses are in — continues when the AI delegations finish (at most until the step timer)."
      : d.next
        ? `Next: ${d.next}`
        : "";
  return (
    <section className={`flex flex-col rounded-2xl border border-gray-100 bg-white p-4 shadow-sm lg:min-h-[260px] ${STAGE_H}`} data-testid="chair-panel" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-light">
          <Gavel size={20} className="text-brand" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Automatic chair</p>
          <p className="text-base font-black leading-tight text-gray-900">{ACTION_LABEL[p.type] ?? d.title}</p>
          <p className="text-xs text-gray-500">{subStateOf(state)}</p>
        </div>
        <div className="shrink-0 text-right" data-testid="chair-timer">
          {t?.mode === "countdown" && (
            <>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{t.label}</p>
              <Countdown atMs={t.atMs} now={now} warn={p.type === "SPEECH"} size="md" />
            </>
          )}
          {t?.mode === "waiting" && <Spinner label="Waiting for human responses" />}
        </div>
      </div>
      <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
        {t?.mode === "waiting" && <WaitingBadge pending={t.pending} spinner={false} />}
        {ballot && (
          <div className="space-y-2 rounded-xl border border-gray-100 p-3" data-testid="current-ballot">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Current vote · {ballot.kind === "procedural" ? "procedural (Yes/No)" : "substantive (Yes/No/Abstain)"}
            </p>
            <BallotSubject state={state} b={ballot} />
            <VoteChart state={state} b={ballot} compact />
          </div>
        )}
        {condition && t?.mode !== "waiting" && <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">{condition}</p>}
        <details className="text-xs text-gray-600">
          <summary className="flex cursor-pointer list-none items-center gap-1 font-bold text-gray-500">
            <ChevronDown size={13} /> Procedure details
          </summary>
          <p className="mt-1">
            <b>{d.title}.</b> {d.detail}
          </p>
          <p className="mt-1 text-[11px] text-gray-400">
            Waiting for required human responses (up to {Math.round((state.settings.timers.responseWaitSec ?? 0) / 60) || "—"} min) is a BridgeMUN online operating policy (W1), not an HMUN rule.
          </p>
        </details>
      </div>
    </section>
  );
}

/**
 * Right: who has the floor. Always in the same place (also during motions and votes). The video element passed
 * as `video` stays mounted the whole time; an AI statement or the idle notice is drawn on top of it.
 */
export function SpeakerPanel({ state, video, aiAudio }: { state: PublicForumState; now?: number; video: React.ReactNode; aiAudio?: React.ReactNode }) {
  const p = state.phase;
  const seatId = p.type === "SPEECH" || p.type === "SPEECH_PREP" || p.type === "AI_SPEECH_PENDING" || p.type === "SPEECH_CONFIRM" ? p.seat : null;
  const speaker = seatId ? state.seats[seatId] : null;
  const aiSpeaking = p.type === "SPEECH" && p.speakerKind === "ai" && p.ai;
  const status =
    p.type === "SPEECH"
      ? "Speaking"
      : p.type === "SPEECH_PREP"
        ? "Getting ready to speak"
        : p.type === "AI_SPEECH_PENDING"
          ? "Preparing a statement (AI)"
          : p.type === "SPEECH_CONFIRM"
            ? "Confirming the record"
            : "";
  return (
    <section className={`flex flex-col overflow-hidden rounded-2xl bg-[#020617] lg:min-h-[260px] text-white shadow-sm ${STAGE_H}`} data-testid="speaker-panel">
      <div className="flex items-center gap-2 px-4 py-3">
        {speaker ? (
          <>
            <Flag code={speaker.id} className="h-6 w-9" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-black">{speaker.countryName}</p>
              <p className="flex items-center gap-1 text-[11px] text-gray-300">
                {p.type === "SPEECH" && <Mic size={11} />} {status}
              </p>
            </div>
            <KindBadge seat={speaker} />
          </>
        ) : (
          <p className="text-xs font-bold text-gray-400">No one has the floor right now</p>
        )}
      </div>
      <div className="relative min-h-[110px] flex-1 lg:min-h-[180px]">
        {/* always mounted: no reconnect when the step changes */}
        <div className="absolute inset-0">{video}</div>
        {aiSpeaking && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-start gap-2 overflow-y-auto bg-[#020617] px-5 py-3 text-center custom-scrollbar" data-testid="ai-speech-text">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-600/30">
              <Bot size={18} className="text-purple-200" />
            </span>
            <p className="text-sm leading-relaxed text-purple-50">{p.ai!.text}</p>
          </div>
        )}
        {p.type === "AI_SPEECH_PENDING" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-3 bg-[#020617] text-sm text-gray-300">
            <Spinner label="AI is preparing a statement" tone="brand" /> The AI delegation is preparing its statement…
          </div>
        )}
        {!speaker && <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#020617] text-xs text-gray-500">Waiting for the next speaker</div>}
      </div>
      {aiAudio}
    </section>
  );
}
