"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Keyboard, Loader2, Mic, MicOff, Play, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { PublicForumState } from "@/engine/publicView";
import type { Phase } from "@/engine/types";
import type { useForumActions } from "@/hooks/useForumActions";
import type { SpeechPrep } from "@/hooks/useSpeechPrep";
import { fmtClock } from "@/lib/phaseText";
import { publicResponseView } from "@/lib/meetingFlow";
import { Countdown, ExpiryWarning, Flag } from "./Visuals";

type Recorder = { status: string; detail: string };
/** Main button area: stays visible at the bottom of the dialog while the content scrolls (mobile). */
const stickyFoot = "sticky bottom-0 z-[1] -mx-4 mt-3 border-t border-gray-100 bg-white px-4 pb-4 pt-3 sm:-mx-6 sm:px-6";
type Props = {
  state: PublicForumState;
  mySeat: string;
  actions: ReturnType<typeof useForumActions>;
  recorder: Recorder;
  prep: SpeechPrep;
  now: number;
};

/** Seconds the delegate may speak (S1 allowance or the official time), as the engine will set it. */
function allowedSec(state: PublicForumState, p: Extract<Phase, { type: "SPEECH_PREP" }>): number {
  const official = p.context.kind === "yield" ? p.context.sec : p.context.kind === "mod_caucus" ? (state.activeCaucus?.speakingSec ?? state.speakingTimeSec) : state.speakingTimeSec;
  if (p.context.kind === "yield") return official;
  return Math.max(official, state.settings.timers.humanSpeechMaxSec ?? 0);
}

/**
 * The delegate's own turn, full width: who, how much time, the chosen way of speaking and its one main button.
 * Preparation (method, microphone permission, text draft) is done here BEFORE "Start speech", so it never uses
 * speaking time. Text drafts are only submitted by the delegate, and only while they hold the floor.
 */
export function SpeechFocus({ state, mySeat, actions, recorder, prep, now }: Props) {
  const p = state.phase;
  const me = state.seats[mySeat];
  const speaking = p.type === "SPEECH" && p.seat === mySeat && p.speakerKind === "human";
  const preparing = p.type === "SPEECH_PREP" && p.seat === mySeat;
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [yieldTo, setYieldTo] = useState("");
  const [ending, setEnding] = useState(false);
  if (!speaking && !preparing) return null;
  const rv = publicResponseView(state);
  const left = speaking ? p.deadlineMs - now : 0;

  // End / submit / expiry can race: the buttons lock while one is in flight; the server applies only the first.
  const endSpeech = async () => {
    if (ending || submitting) return;
    setEnding(true);
    await actions.send({ type: "end_speech", seat: mySeat, ...(yieldTo ? { yieldTo } : {}) }, { phaseId: state.phaseId });
    setEnding(false);
  };
  const submitText = async () => {
    if (submitting || ending) return;
    setSubmitting(true);
    setFailed(false);
    const ok = await actions.send({ type: "submit_text_speech", seat: mySeat, text: prep.draft }, { phaseId: state.phaseId });
    setSubmitting(false);
    if (ok) prep.clearDraft();
    else setFailed(true);
  };

  return (
    <section className="mx-auto min-h-0 w-full max-w-3xl overflow-y-auto overscroll-contain rounded-t-3xl border-2 border-brand bg-white p-4 pb-0 shadow-[6px_6px_0_var(--bm-sun)] sm:rounded-3xl sm:p-6 sm:pb-0" data-testid="speech-focus">
      <div className="flex items-start gap-3">
        <Flag code={mySeat} className="h-12 w-16" />
        <div className="min-w-0 flex-1">
          <p className="bm-heading truncate text-lg font-black text-gray-900">{me.countryName}</p>
          <p className="bm-heading text-xl font-black text-brand" aria-live="polite">{speaking ? "You have the floor — speaking" : "Your turn — get ready"}</p>
          <p className="text-xs text-gray-500">
            {p.type === "SPEECH" || p.type === "SPEECH_PREP" ? (p.context.kind === "mod_caucus" ? `Moderated caucus · “${state.activeCaucus?.topic ?? ""}”` : p.context.kind === "yield" ? "Yielded time" : "General speakers’ list") : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {speaking ? (
            <>
              <p className="text-[10px] font-black uppercase tracking-widest text-red-600">Speaking · time left</p>
              <Countdown atMs={p.deadlineMs} now={now} />
            </>
          ) : (
            <>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Your speaking time</p>
              <p className="font-mono text-3xl font-black text-gray-400" data-testid="speech-time-not-started">{fmtClock(allowedSec(state, p as Extract<Phase, { type: "SPEECH_PREP" }>) * 1000)}</p>
              <p className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-black uppercase text-gray-500">Not started · begins when you press Start</p>
            </>
          )}
        </div>
      </div>

      {speaking && left <= 60_000 && (
        <div role="alert" className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${left <= 15_000 ? "border-red-400 bg-red-100 text-red-800" : "border-amber-300 bg-amber-50 text-amber-900"}`} data-testid={left <= 15_000 ? "speech-warning-15" : "speech-warning-60"}>
          <AlertTriangle size={16} />
          {left <= 15_000 ? "15 seconds left. Your speech ends automatically when the time runs out." : "1 minute left in your speech."}
        </div>
      )}

      {/* method */}
      <div className="mt-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="How will you speak?">
        {(
          [
            ["mic", Mic, "Microphone"],
            ["text", Keyboard, "Text"],
          ] as const
        ).map(([m, Icon, label]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={prep.mode === m}
            onClick={() => prep.setMode(m)}
            className={`flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-black ${prep.mode === m ? "border-brand bg-brand text-white" : "border-gray-200 text-gray-600 hover:border-brand/40"}`}
            data-testid={`mode-${m}`}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {prep.mode === "mic" ? (
        <div className="mt-3 space-y-3">
          <MicStatus prep={prep} recorder={recorder} speaking={speaking} />
          {speaking && (
            <div className={stickyFoot}>
              <Button size="lg" data-autofocus className="w-full justify-center bg-red-600 py-6 text-lg hover:bg-red-700" disabled={actions.busy || ending} onClick={() => void endSpeech()} data-testid="end-speech">
                {ending ? <Loader2 size={18} className="mr-2 animate-spin" /> : <Square size={18} className="mr-2" />} {ending ? "Ending…" : "End speech"}
              </Button>
              <p className="pt-1 text-center text-xs font-semibold text-gray-600">Click End speech when you finish. Hiding this screen does not end your speech.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <textarea
            value={prep.draft}
            onChange={(e) => prep.setDraft(e.target.value)}
            rows={speaking ? 9 : 7}
            data-autofocus={speaking ? true : undefined}
            maxLength={4000}
            placeholder="Type your statement…"
            className="w-full rounded-xl border-2 border-gray-200 p-3 text-base focus:border-brand focus:outline-none"
            data-testid="speech-text"
          />
          <p className="text-[11px] text-gray-500">{speaking ? "Submitting your text ends your turn." : "Your draft is saved on this device. You can submit it once your speech has started."}</p>
          {speaking && (
            <div className={stickyFoot}>
              {failed && (
                <p role="alert" className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700" data-testid="submit-failed">
                  Not submitted{actions.error ? ` — ${actions.error}` : ""}. Your text is kept; try again.
                </p>
              )}
              <Button size="lg" className="w-full justify-center py-6 text-lg" disabled={submitting || ending || !prep.draft.trim()} onClick={() => void submitText()} data-testid="submit-text">
                {submitting ? <Loader2 size={18} className="mr-2 animate-spin" /> : <Send size={18} className="mr-2" />}
                {submitting ? "Submitting…" : "Submit text speech"}
              </Button>
            </div>
          )}
        </div>
      )}

      {preparing && (
        <div className={`${stickyFoot} space-y-2`}>
          <Button size="lg" data-autofocus className="w-full justify-center py-6 text-lg" disabled={actions.busy} onClick={() => void actions.send({ type: "start_speech", seat: mySeat }, { phaseId: state.phaseId })} data-testid="start-speech-button">
            <Play size={18} className="mr-2" /> Start speech
          </Button>
          {rv?.kind === "start_speech" && rv.pending.includes(mySeat) && <ExpiryWarning rv={rv} now={now} />}
        </div>
      )}

      {speaking && prep.mode === "mic" && p.context.kind === "speakers_list" && (
        <details className="mt-3 text-xs text-gray-600">
          <summary className="flex cursor-pointer list-none items-center gap-1 font-bold text-gray-500">
            <ChevronDown size={13} /> Yield (optional)
          </summary>
          <select value={yieldTo} onChange={(e) => setYieldTo(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-sm" aria-label="Yield">
            <option value="">Yield to the chair</option>
            {Object.values(state.seats)
              .filter((x) => x.id !== mySeat && (x.attendance === "present" || x.attendance === "present_and_voting"))
              .map((x) => (
                <option key={x.id} value={x.id}>
                  Yield the remaining official time to {x.countryName}
                </option>
              ))}
          </select>
          <p className="mt-1">Applies when you click End speech (microphone). Rule 18: only the remaining official speaking time is yielded.</p>
        </details>
      )}
      {speaking && prep.mode === "text" && (
        <button type="button" className="mt-2 text-[11px] font-bold text-gray-400 underline" disabled={actions.busy || submitting || ending} onClick={() => void endSpeech()}>
          End without submitting text
        </button>
      )}

      <details className="mb-4 mt-3 text-xs text-gray-500">
        <summary className="flex cursor-pointer list-none items-center gap-1 font-bold">
          <ChevronDown size={13} /> How speaking works here
        </summary>
        <p className="mt-1">
          Human delegates may speak for up to {fmtClock((state.settings.timers.humanSpeechMaxSec || state.speakingTimeSec) * 1000)} (BridgeMUN online operating policy S1, not an HMUN rule). The official
          speaking time ({state.speakingTimeSec} s) still counts for the agenda and for moderated caucuses; extra time you actually use is added back to the session clock. Ending early moves the meeting on at once.
          With the microphone, your recording is transcribed and you confirm it before it enters the record. A text speech enters the record when submitted.
        </p>
      </details>
    </section>
  );
}

function MicStatus({ prep, recorder, speaking }: { prep: SpeechPrep; recorder: Recorder; speaking: boolean }) {
  const s = speaking ? recorder.status : prep.mic;
  const tone =
    s === "recording" || s === "ready"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : s === "denied" || s === "unsupported" || s === "unavailable" || s === "error"
        ? "border-red-200 bg-red-50 text-red-800"
        : "border-gray-200 bg-gray-50 text-gray-700";
  const label = speaking
    ? s === "recording"
      ? "Recording"
      : s === "unavailable" || s === "error"
        ? "Microphone not available"
        : "Starting microphone…"
    : s === "ready"
      ? "Microphone ready"
      : s === "checking"
        ? "Waiting for permission…"
        : s === "slow"
          ? "Permission request not answered yet"
          : s === "denied"
            ? "Microphone blocked by the browser"
            : s === "unsupported"
              ? "Microphone not available in this browser"
              : "Permission needed";
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold ${tone}`} data-testid="mic-status">
      {s === "recording" ? <span className="h-2.5 w-2.5 rounded-full bg-red-600 motion-safe:animate-pulse" /> : s === "ready" ? <CheckCircle2 size={16} /> : s === "checking" ? <Loader2 size={16} className="animate-spin" /> : <MicOff size={16} />}
      <span>{label}</span>
      {!speaking && s !== "ready" && s !== "checking" && s !== "unsupported" && (
        <Button size="sm" variant="secondary" onClick={() => void prep.checkMic()}>
          {s === "denied" ? "Try again" : "Check microphone"}
        </Button>
      )}
      {(s === "slow" || s === "denied" || s === "unsupported" || s === "unavailable" || s === "error" || (speaking && recorder.detail)) && (
        <Button size="sm" variant="outline" onClick={() => prep.setMode("text")} data-testid="switch-to-text">
          Use text instead
        </Button>
      )}
      {speaking && recorder.detail && <span className="w-full text-xs font-semibold">{recorder.detail}</span>}
    </div>
  );
}
