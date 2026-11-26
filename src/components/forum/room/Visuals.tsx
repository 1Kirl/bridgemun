"use client";

import { AlertTriangle, Bot, Check, ChevronDown, ClipboardCheck, Gavel, Hourglass, MessagesSquare, Mic, Repeat2, Scale, Trophy, User, Users, Vote, WifiOff } from "lucide-react";
import type { PublicBallot, PublicForumState } from "@/engine/publicView";
import { EXPIRY_ACTION, type ResponseView } from "@/engine/responses";
import type { Seat } from "@/engine/types";
import { describePhase, fmtClock } from "@/lib/phaseText";
import { DEBATE_MODES, STAGES, actorOf, debateModeOf, outcomeLabel, passRule, stageOf, subStateOf, timerOf, type Stage } from "@/lib/meetingFlow";

export const Flag = ({ code, className = "h-3.5 w-5" }: { code: string; className?: string }) => (
  <img src={`https://flagcdn.com/w40/${code}.png`} alt="" className={`${className} shrink-0 rounded-sm object-cover ring-1 ring-black/5`} />
);

export function KindBadge({ seat }: { seat: Seat }) {
  return seat.kind === "ai" ? (
    <span className="inline-flex items-center gap-0.5 rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-purple-700">
      <Bot size={10} /> AI
    </span>
  ) : (
    <span className="inline-flex items-center gap-0.5 rounded bg-brand-light px-1.5 py-0.5 text-[9px] font-black uppercase text-brand">
      <User size={10} /> Human
    </span>
  );
}

const STAGE_ICON: Record<Stage, typeof Gavel> = { roll_call: ClipboardCheck, debate: MessagesSquare, voting: Vote, results: Trophy };

/** A. Overall progress: real stage only (no percentages). The debate stage is a loop of modes switched by motions. */
export function StageTrack({ state }: { state: PublicForumState }) {
  const cur = stageOf(state);
  const order = STAGES.map((x) => x.id);
  const ci = order.indexOf(cur);
  const closed = state.phase.type === "CLOSED";
  const votingSkipped = closed && !state.debateClosed;
  const mode = debateModeOf(state);
  return (
    <nav aria-label="Meeting progress" className="border-b border-gray-200 bg-white px-3 py-2.5 sm:px-5">
      <ol className="flex items-stretch gap-1 overflow-x-auto custom-scrollbar">
        {STAGES.map((st, i) => {
          const Icon = STAGE_ICON[st.id];
          const status = st.id === "voting" && votingSkipped ? "skipped" : i < ci ? "done" : i === ci ? "current" : "upcoming";
          return (
            <li key={st.id} className="flex shrink-0 items-center gap-1">
              {i > 0 && <span className={`h-0.5 w-3 shrink-0 sm:w-6 ${i <= ci ? "bg-brand" : "bg-gray-200"}`} aria-hidden />}
              <div
                className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-bold ${
                  status === "current" ? "border-brand bg-brand text-white shadow-sm" : status === "done" ? "border-brand/30 bg-brand-light text-brand" : status === "skipped" ? "border-dashed border-gray-300 text-gray-400" : "border-gray-200 text-gray-400"
                }`}
                aria-current={status === "current" ? "step" : undefined}
              >
                {status === "done" ? <Check size={14} /> : <Icon size={14} />}
                <span className={`whitespace-nowrap ${status === "current" ? "" : "sr-only sm:not-sr-only"}`}>{st.label}</span>
                {st.id === "debate" && <Repeat2 size={13} className={status === "current" ? "text-white/80" : "text-gray-300"} aria-label="repeats" />}
                {status === "skipped" && <span className="text-[9px] uppercase">not reached</span>}
              </div>
            </li>
          );
        })}
      </ol>
      {cur === "debate" && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="debate-modes">
          <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-gray-400">
            <Repeat2 size={12} /> switch by motion
          </span>
          {DEBATE_MODES.map((m) => (
            <span key={m.id} title={m.hint} className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${mode === m.id ? "border-brand bg-brand/10 text-brand" : "border-gray-200 text-gray-400"}`}>
              {m.label}
            </span>
          ))}
          <span className="ml-1 rounded-full bg-gray-900 px-2 py-0.5 text-[11px] font-bold text-white">{subStateOf(state)}</span>
        </div>
      )}
      {cur !== "debate" && state.phase.type !== "CLOSED" && (
        <div className="mt-2">
          <span className="rounded-full bg-gray-900 px-2 py-0.5 text-[11px] font-bold text-white">{subStateOf(state)}</span>
        </div>
      )}
    </nav>
  );
}

/** Large server-time countdown; turns amber under 60 s and red (pulsing unless reduced motion) under 15 s. */
export function Countdown({ atMs, now, warn = true, size = "lg" }: { atMs: number; now: number; warn?: boolean; size?: "lg" | "md" }) {
  const left = atMs - now;
  const tone = !warn ? "text-gray-900" : left <= 15_000 ? "text-red-600 motion-safe:animate-pulse" : left <= 60_000 ? "text-amber-600" : "text-gray-900";
  return (
    <span className={`font-mono font-black tabular-nums leading-none ${size === "lg" ? "text-4xl sm:text-5xl" : "text-2xl"} ${tone}`} data-testid="phase-countdown">
      {fmtClock(left)}
    </span>
  );
}

const ACTION_LABEL: Partial<Record<string, string>> = {
  BRIEFING: "Opening briefing",
  ROLL_CALL: "Roll call",
  SPEECH_PREP: "Getting ready to speak",
  AI_SPEECH_PENDING: "Preparing a statement",
  SPEECH: "Speaking",
  SPEECH_CONFIRM: "Confirming the record",
  FLOOR_OPEN: "Taking motions",
  MOTION_VOTE: "Voting on a motion",
  MOD_CAUCUS: "Moderated caucus — taking volunteers",
  UNMOD_CAUCUS: "Negotiating (unmoderated caucus)",
  SUSPENDED: "Meeting suspended",
  DR_INTRO: "Resolution introduction",
  AMENDMENT_SPONSOR_RESPONSE: "Sponsors responding",
  VP_FLOOR: "Voting procedure — motions",
  DIVISION_PROPOSALS: "Proposals to divide",
  VOTING_PROCEDURE: "Voting procedure",
};

/** B. What is happening now: who acts, the action, the time left, what moves the meeting on. Long text folded away. */
export function SituationCard({ state, rv, now }: { state: PublicForumState; rv: ResponseView | null; now: number }) {
  const actor = actorOf(state);
  const t = timerOf(state, rv);
  const d = describePhase(state);
  const p = state.phase;
  const pending = rv && rv.holds ? rv.pending.length : 0;
  const condition =
    rv && rv.holds && rv.required.length > 0
      ? pending > 0
        ? `Continues when ${pending} more human delegate${pending > 1 ? "s" : ""} respond${pending > 1 ? "" : "s"} — or when the response window ends`
        : "All human responses are in — continues as soon as the AI delegations finish (at most until the step timer)"
      : d.next
        ? `Next: ${d.next}`
        : "";
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" aria-live="polite" data-testid="situation">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-100">
          {actor ? <Flag code={actor.id} className="h-12 w-12" /> : p.type === "UNMOD_CAUCUS" ? <Users size={22} className="text-brand" /> : p.type.includes("VOT") ? <Scale size={22} className="text-brand" /> : <Gavel size={22} className="text-brand" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {actor ? (
              <>
                <span className="truncate text-base font-black text-gray-900">{actor.countryName}</span>
                <KindBadge seat={actor} />
              </>
            ) : (
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">Automatic chair</span>
            )}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-sm font-bold text-brand">
            {p.type === "SPEECH" && <Mic size={14} />} {ACTION_LABEL[p.type] ?? d.title}
            {(p.type === "MOTION_VOTE" || p.type === "VOTING_PROCEDURE") && subStateOf(state) !== ACTION_LABEL[p.type] ? <span className="font-normal text-gray-500">· {subStateOf(state)}</span> : null}
          </p>
        </div>
        {t && (
          <div className="shrink-0 text-right">
            <p className={`text-[10px] font-black uppercase tracking-widest ${t.isResponse ? "text-amber-700" : "text-gray-500"}`}>{t.label}</p>
            <Countdown atMs={t.atMs} now={now} warn={t.isResponse || p.type === "SPEECH"} />
          </div>
        )}
      </div>
      {condition && <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">{condition}</p>}
      <details className="mt-2 text-xs text-gray-600">
        <summary className="flex cursor-pointer list-none items-center gap-1 font-bold text-gray-500">
          <ChevronDown size={13} /> Procedure details
        </summary>
        <p className="mt-1">
          <b>{d.title}.</b> {d.detail}
        </p>
        {d.next && <p className="mt-0.5 text-gray-500">Next: {d.next}</p>}
        <p className="mt-1 text-[11px] text-gray-400">
          Waiting for required human responses (up to {Math.round((state.settings.timers.responseWaitSec ?? 0) / 60) || "—"} min) is a BridgeMUN online operating policy (W1), not an HMUN rule.
        </p>
      </details>
    </section>
  );
}

const RV_TITLE: Record<string, string> = {
  attendance: "Attendance declared",
  start_speech: "Speaker started",
  confirm_transcript: "Record confirmed",
  motion: "Responded on the floor",
  voting_motion: "Responded on the floor",
  division: "Responded on division",
  vote: "Human votes cast",
  volunteer: "Volunteered or passed",
  sponsor: "Sponsor responses",
  caucus_ready: "Ready to resume",
};

/** E. Human response status. Shows WHO has responded, never how anyone voted. */
export function ResponseTracker({ state, rv, mySeat }: { state: PublicForumState; rv: ResponseView | null; mySeat: string }) {
  if (!rv || rv.required.length === 0) return null;
  const n = rv.required.length;
  const done = rv.responded.length;
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" data-testid="response-tracker">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-gray-800">
          <Hourglass size={13} className="text-brand" /> {RV_TITLE[rv.kind]}
        </h3>
        <span className="text-sm font-black text-gray-900" aria-label={`${done} of ${n} human delegates responded`}>
          {done} / {n} <span className="text-xs font-semibold text-gray-500">humans</span>
        </span>
      </div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={n} aria-valuenow={done}>
        {rv.required.map((id) => (
          <span key={id} className={`flex-1 ${rv.responded.includes(id) ? "bg-emerald-500" : "bg-gray-200"}`} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {rv.required.map((id) => {
          const s = state.seats[id];
          const ok = rv.responded.includes(id);
          const off = s.connection === "offline";
          return (
            <li key={id} className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : off ? "border-gray-200 bg-gray-50 text-gray-400" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
              <Flag code={id} className="h-3 w-4" />
              {s.countryName}
              {id === mySeat && <span className="text-[9px] uppercase">(you)</span>}
              {ok ? <Check size={12} aria-label="responded" /> : <Hourglass size={12} aria-label="awaiting response" />}
              {off && <WifiOff size={12} aria-label="offline" />}
              {rv.standing.includes(id) && <span className="text-[9px] font-black uppercase">{rv.kind === "volunteer" ? "passing this caucus" : "no motion stands"}</span>}
              <span className="sr-only">{ok ? "responded" : "awaiting response"}{off ? ", currently offline (still has the full response time)" : ""}</span>
            </li>
          );
        })}
      </ul>
      {rv.pending.some((id) => state.seats[id].connection === "offline") && (
        <p className="mt-1.5 text-[11px] text-gray-500">A delegate who is offline keeps the full response time: the step waits until their deadline (a refresh or reconnect does not reset or shorten it).</p>
      )}
      {rv.standing.length > 0 && (
        <p className="mt-1.5 text-[11px] text-gray-500">
          {rv.kind === "volunteer"
            ? "“Passing this caucus” was chosen by the delegate; they can volunteer in any turn."
            : "“No motion stands”: the delegate said they had no motion and nothing has changed since, so they are not asked again. They can still move a motion."}
        </p>
      )}
    </section>
  );
}

/** Response-window warning for the current user (60 s: notice, 15 s: urgent). States the actual consequence. */
export function ExpiryWarning({ rv, now }: { rv: ResponseView; now: number }) {
  if (!rv.wait) return null;
  const left = rv.wait.responseDeadlineMs - now;
  const what = EXPIRY_ACTION[rv.kind];
  if (left > 60_000)
    return (
      <p className="text-[11px] text-gray-500">
        You have until the response window ends ({fmtClock(left)}). If you do not respond, {what}.
      </p>
    );
  const urgent = left <= 15_000;
  return (
    <div role="alert" className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs font-bold ${urgent ? "border-red-300 bg-red-50 text-red-800" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
      <AlertTriangle size={16} className={`shrink-0 ${urgent ? "motion-safe:animate-pulse" : ""}`} />
      <span>
        {fmtClock(Math.max(0, left))} left — if you do not respond, {what}.
      </span>
    </div>
  );
}

// ── 9. vote charts ───────────────────────────────────────────────

const SEG = {
  yes: "bg-emerald-500",
  no: "bg-rose-500",
  abstain: "bg-slate-400",
  notVoted: "bg-[repeating-linear-gradient(135deg,#e5e7eb_0_4px,#f8fafc_4px_8px)]",
};

/** Live: progress of who has voted (choices stay hidden). Closed: Yes/No/Abstain/Not voted with the correct pass line. */
export function VoteChart({ state, b, compact = false }: { state: PublicForumState; b: PublicBallot; compact?: boolean }) {
  const e = Object.keys(b.eligible).length;
  const outcome = outcomeLabel(b);
  if (b.status === "not_held") {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
        Vote not held — no voting quorum ({b.presentAtOpen} present, {b.quorumRequired} required, rule 32). This is not a rejection.
      </div>
    );
  }
  if (b.status !== "closed" || !b.result) {
    const voted = b.voted.length;
    const humans = Object.entries(b.eligible).filter(([, x]) => x.kind === "human").map(([id]) => id);
    return (
      <div data-testid="vote-progress">
        <div className="mb-1 flex justify-between text-xs font-bold text-gray-700">
          <span>{b.status === "reading" ? "Reading — voting opens soon" : "Votes cast"}</span>
          <span>
            {voted} / {e}
          </span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuemin={0} aria-valuemax={e} aria-valuenow={voted}>
          <div className="h-full bg-brand transition-[width] duration-500" style={{ width: `${e ? (voted / e) * 100 : 0}%` }} />
        </div>
        <p className="mt-1 text-[11px] text-gray-500">
          Humans voted {humans.filter((h) => b.voted.includes(h)).length}/{humans.length} · AI voted {b.voted.filter((x) => !humans.includes(x)).length}/{e - humans.length} · how each delegation voted is revealed when the vote closes.
        </p>
      </div>
    );
  }
  const r = b.result;
  const showAbstain = b.kind === "substantive";
  const nv = r.notVoted.length;
  const rows: Array<{ k: keyof typeof SEG; label: string; n: number }> = [
    { k: "yes", label: "Yes", n: r.yes },
    { k: "no", label: "No", n: r.no },
    ...(showAbstain ? [{ k: "abstain" as const, label: "Abstain", n: r.abstain }] : []),
    { k: "notVoted", label: "Not voted", n: nv },
  ];
  const rule = passRule(b, state.settings.policies);
  const total = Math.max(1, e);
  return (
    <div data-testid={`vote-chart-${b.id}`}>
      <div className="flex items-center justify-between gap-2">
        {outcome && (
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-black ${outcome.tone === "pass" ? "bg-emerald-100 text-emerald-800" : outcome.tone === "fail" ? "bg-rose-100 text-rose-800" : "bg-slate-200 text-slate-700"}`}>{outcome.text}</span>
        )}
        <span className="text-[11px] font-semibold text-gray-500">{b.kind === "procedural" ? "Procedural · Yes/No" : "Substantive · Yes/No/Abstain"} · {e} eligible</span>
      </div>
      <div className="relative mt-1.5">
        <div className={`flex overflow-hidden rounded-md ${compact ? "h-4" : "h-6"}`} role="img" aria-label={rows.map((x) => `${x.label} ${x.n}`).join(", ")}>
          {rows.map((x) => (x.n > 0 ? <div key={x.k} className={`${SEG[x.k]} flex items-center justify-center text-[10px] font-black text-white`} style={{ width: `${(x.n / total) * 100}%` }}>{!compact && x.k !== "notVoted" ? x.n : ""}</div> : null))}
        </div>
        {rule.scale === "eligible" && (
          <div className="pointer-events-none absolute inset-y-[-3px] border-l-2 border-gray-900" style={{ left: `${(rule.needYes / total) * 100}%` }} aria-hidden>
            <span className="absolute -top-4 -translate-x-1/2 whitespace-nowrap text-[9px] font-black text-gray-900">{rule.needYes} Yes needed</span>
          </div>
        )}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-semibold text-gray-700">
        {rows.map((x) => (
          <li key={x.k} className="flex items-center gap-1">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${SEG[x.k]} ${x.k === "notVoted" ? "ring-1 ring-gray-300" : ""}`} />
            {x.label} <b>{x.n}</b>
          </li>
        ))}
      </ul>
      {rule.scale === "decisive" && (r.yes + r.no > 0 ? <DecisiveBar yes={r.yes} no={r.no} ratio={rule.ratio} /> : null)}
      <p className="mt-1 text-[10px] text-gray-500">{rule.text}</p>
    </div>
  );
}

/** Substantive votes are decided among Yes + No only: a second bar on that denominator with the pass line. */
function DecisiveBar({ yes, no, ratio }: { yes: number; no: number; ratio: number }) {
  const t = yes + no;
  return (
    <div className="mt-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Yes vs No (decisive votes: {t})</p>
      <div className="relative mt-1 flex h-2.5 overflow-hidden rounded-full">
        <div className="bg-emerald-500" style={{ width: `${(yes / t) * 100}%` }} />
        <div className="bg-rose-500" style={{ width: `${(no / t) * 100}%` }} />
        <div className="absolute inset-y-0 border-l-2 border-gray-900" style={{ left: `${ratio * 100}%` }} aria-hidden />
      </div>
      <p className="mt-0.5 text-[10px] text-gray-500">Pass line at {ratio === 0.5 ? "half (Yes must be more than No)" : "two-thirds"} of Yes + No</p>
    </div>
  );
}
