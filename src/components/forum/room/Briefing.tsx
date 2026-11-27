"use client";

import { ClipboardCheck, FileText, MessagesSquare, Mic, Repeat2, Trophy, Users, Vote } from "lucide-react";
import type { PublicForumState } from "@/engine/publicView";
import { COMMITTEES } from "@/engine/committees";

const LOOP = [
  { icon: Mic, title: "General debate", text: "Speakers' list — sign up to speak" },
  { icon: MessagesSquare, title: "Moderated caucus", text: "Short speeches on one topic" },
  { icon: Users, title: "Negotiation & drafting", text: "Unmoderated caucus: talk, draft, sign" },
  { icon: FileText, title: "Resolutions", text: "Introduction and amendments" },
];

const STEP_MS = 550;

/**
 * Shown to everyone while the engine is in BRIEFING. Card animation and countdown are driven by the server's
 * briefing start/deadline, so a refresh lands at the same point and nothing is shown once roll call has begun.
 */
export function Briefing({ state, now }: { state: PublicForumState; now: number }) {
  const p = state.phase;
  if (p.type !== "BRIEFING") return null;
  const elapsed = Math.max(0, now - p.startedMs);
  const left = Math.max(0, p.deadlineMs - now);
  const total = Math.max(1, p.deadlineMs - p.startedMs);
  const committee = COMMITTEES.find((c) => c.id === state.committeeId);
  // negative delays = the animation continues from where the shared clock is (refresh-safe)
  const anim = (i: number) => ({ animationDelay: `${i * STEP_MS - elapsed}ms` });
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/85 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-label="Opening briefing" data-testid="briefing">
      <div className="w-full max-w-2xl rounded-3xl bg-white p-5 shadow-2xl sm:p-7">
        <p className="text-[11px] font-black uppercase tracking-[0.25em] text-brand">Opening briefing</p>
        <h2 className="mt-1 text-2xl font-black text-gray-900">Based on HMUN 2026 rules of procedure</h2>
        <p className="mt-1 text-sm text-gray-600">
          {committee?.id.replace("_HMUN", "")} — {committee?.name} · ruleset {state.rulesetId}
        </p>

        <ol className="mt-5 space-y-2">
          <Card i={0} anim={anim} icon={ClipboardCheck} title="Roll call" text="Declare Present or Present and voting" />
          <li className="briefing-card rounded-2xl border-2 border-dashed border-brand/30 p-2.5" style={anim(1)}>
            <p className="mb-1.5 flex items-center gap-1 px-1 text-[11px] font-black uppercase tracking-wider text-brand">
              <Repeat2 size={14} /> Debate — these repeat and switch by motion, in any order
            </p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {LOOP.map((x, j) => (
                <div key={x.title} className="briefing-card flex items-center gap-2 rounded-xl bg-brand-light px-3 py-2" style={anim(1.5 + j * 0.5)}>
                  <x.icon size={18} className="shrink-0 text-brand" />
                  <div>
                    <p className="text-sm font-black text-gray-900">{x.title}</p>
                    <p className="text-[11px] text-gray-600">{x.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </li>
          <Card i={4} anim={anim} icon={Vote} title="Final voting" text="Amendments, division, then each resolution" />
          <Card i={4.6} anim={anim} icon={Trophy} title="Results" text="Adopted / not adopted, with the votes" />
        </ol>

        <p className="briefing-card mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900" style={anim(5.2)}>
          BridgeMUN waits up to {Math.round((state.settings.timers.responseWaitSec ?? 300) / 60)} min for the delegates whose response a step needs (an online operating
          policy, not an HMUN rule). AI delegations act on their own; the automatic chair applies the rules.
        </p>

        {/* One shared countdown for the whole briefing (server start → server deadline), with a shrinking gauge. */}
        <div className="mt-5 rounded-2xl bg-gray-900 px-4 py-3 text-white" aria-live="polite">
          <div className="flex items-center justify-center gap-3">
            <span className="text-sm font-bold">Roll call in</span>
            <span className="font-mono text-4xl font-black tabular-nums" data-testid="briefing-countdown">
              {Math.max(0, Math.ceil(left / 1000))}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/20" role="progressbar" aria-label="Time until roll call" aria-valuemin={0} aria-valuemax={Math.round(total / 1000)} aria-valuenow={Math.ceil(left / 1000)}>
            <div className="h-full rounded-full bg-brand" style={{ width: `${total ? Math.max(0, Math.min(100, (left / total) * 100)) : 0}%` }} data-testid="briefing-gauge" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ i, anim, icon: Icon, title, text }: { i: number; anim: (i: number) => React.CSSProperties; icon: typeof Vote; title: string; text: string }) {
  return (
    <li className="briefing-card flex items-center gap-3 rounded-2xl border border-gray-100 bg-white px-3 py-2.5 shadow-sm" style={anim(i)}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-white">
        <Icon size={18} />
      </span>
      <div>
        <p className="text-sm font-black text-gray-900">{title}</p>
        <p className="text-xs text-gray-600">{text}</p>
      </div>
    </li>
  );
}
