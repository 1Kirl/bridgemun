"use client";

import { Clock, Pause } from "lucide-react";
import type { PublicForumState } from "@/engine/publicView";
import { describePhase, fmtClock, phaseDeadlineOf } from "@/lib/phaseText";

/** Always-visible: current step, what it means, what comes next, and the server-time countdown. */
export function PhaseBar({ state, now }: { state: PublicForumState; now: () => number }) {
  const d = describePhase(state);
  const deadline = phaseDeadlineOf(state);
  const remaining = deadline !== null ? deadline - now() : null;
  const sessionLeft = state.settings.sessionEndsAtMs ? state.settings.sessionEndsAtMs - now() : null;
  return (
    <section className="flex flex-col gap-3 border-b border-gray-200 bg-white px-5 py-3 shadow-sm md:flex-row md:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand">Now</p>
        <p className="truncate text-xl font-black text-gray-900">{d.title}</p>
        <p className="text-xs text-gray-600">{d.detail}</p>
        {d.next && (
          <p className="mt-0.5 text-xs text-gray-400">
            <span className="font-bold">Next:</span> {d.next}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {state.paused ? (
          <div className="flex items-center gap-2 rounded-xl bg-amber-100 px-4 py-2 text-amber-900">
            <Pause size={18} />
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest">App paused</p>
              <p className="text-xs">Auto-resume in {fmtClock(state.paused.autoResumeAtMs - now())}</p>
            </div>
          </div>
        ) : remaining !== null ? (
          <div className={`rounded-xl px-4 py-2 text-center ${remaining < 10_000 ? "bg-red-50 text-red-700" : "bg-brand-light text-brand"}`}>
            <p className="text-[10px] font-black uppercase tracking-widest">Step ends in</p>
            <p className="font-mono text-3xl font-black leading-none" data-testid="phase-countdown">
              {fmtClock(remaining)}
            </p>
          </div>
        ) : null}
        {sessionLeft !== null && state.phase.type !== "CLOSED" && (
          <div className="rounded-xl bg-gray-100 px-3 py-2 text-center text-gray-700">
            <p className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest">
              <Clock size={10} /> Session
            </p>
            <p className="font-mono text-lg font-black leading-none">{fmtClock(sessionLeft)}</p>
          </div>
        )}
      </div>
    </section>
  );
}
