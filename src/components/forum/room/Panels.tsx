"use client";

import { Bot, Crown, MessageSquare, User, Vote, WifiOff } from "lucide-react";
import type { PublicBallot, PublicForumState } from "@/engine/publicView";
import type { RecordEntry } from "@/engine/types";
import { describeMotion } from "@/lib/phaseText";

const box = "rounded-2xl border border-gray-100 bg-white p-4 shadow-sm";
const h3 = "mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-gray-800";
const flag = (c: string) => <img src={`https://flagcdn.com/w40/${c}.png`} alt="" className="h-3.5 w-5 shrink-0 rounded-sm object-cover" />;

export function SpeakersList({ state }: { state: PublicForumState }) {
  return (
    <div className={box}>
      <h3 className={h3}>Speakers’ list · {state.speakingTimeSec}s</h3>
      {state.speakersList.length === 0 ? (
        <p className="text-xs text-gray-400">Empty</p>
      ) : (
        <ol className="space-y-1">
          {state.speakersList.map((id, i) => (
            <li key={id} className="flex items-center gap-2 text-sm">
              <span className="w-5 text-right text-xs font-bold text-gray-400">{i + 1}</span>
              {flag(id)}
              <span className="font-bold text-gray-800">{state.seats[id]?.countryName}</span>
              {state.seats[id]?.kind === "ai" && <span className="text-[9px] font-black uppercase text-purple-600">AI</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function SeatGrid({ state, mySeat }: { state: PublicForumState; mySeat: string }) {
  const seats = Object.values(state.seats).sort((a, b) => a.countryName.localeCompare(b.countryName));
  const speaking = "seat" in state.phase ? (state.phase as { seat: string }).seat : null;
  return (
    <div className={box}>
      <h3 className={h3}>Delegations</h3>
      <div className="grid grid-cols-2 gap-1.5">
        {seats.map((s) => {
          const present = s.attendance !== "not_recorded";
          return (
            <div key={s.id} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${s.id === speaking ? "border-red-300 bg-red-50" : s.id === mySeat ? "border-brand/40 bg-brand/5" : "border-gray-100"}`}>
              {flag(s.id)}
              <span className={`min-w-0 flex-1 truncate font-bold ${present ? "text-gray-800" : "text-gray-400"}`}>{s.countryName}</span>
              {s.kind === "ai" ? <Bot size={11} className="text-purple-600" /> : s.uid === state.ownerUid ? <Crown size={11} className="text-brand" /> : <User size={11} className="text-brand" />}
              {s.kind === "human" && s.connection === "offline" && <WifiOff size={11} className="text-gray-400" />}
              <span className="text-[9px] font-black uppercase text-gray-400">{s.attendance === "present_and_voting" ? "P&V" : present ? "P" : "–"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FloorMotions({ state }: { state: PublicForumState }) {
  const p = state.phase;
  const windowId = p.type === "FLOOR_OPEN" || p.type === "MOTION_VOTE" ? p.windowId : null;
  if (!windowId) return null;
  const list = Object.values(state.motions)
    .filter((m) => m.windowId === windowId)
    .sort((a, b) => a.submittedAtMs - b.submittedAtMs);
  return (
    <div className={box}>
      <h3 className={h3}>
        <Vote size={14} className="text-brand" /> Motions on the floor
      </h3>
      {list.length === 0 ? (
        <p className="text-xs text-gray-400">No motions yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((m) => (
            <li key={m.id} className="rounded-lg border border-gray-100 px-2 py-1.5 text-xs">
              <div className="flex items-center gap-1.5">
                {flag(m.mover)}
                <span className="font-bold text-gray-800">{describeMotion(m.params)}</span>
                <StatusPill status={m.status} />
              </div>
              {m.carriedFromWindowId && <p className="mt-0.5 text-[10px] text-amber-700">Carried over from an earlier window (D3) — re-checked when this window closes.</p>}
              {m.disposition && <p className="mt-0.5 text-[10px] text-gray-500">{m.disposition.reason} · {m.disposition.source.replace("_", " ")}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-gray-100 text-gray-600",
    voting: "bg-brand-light text-brand",
    adopted: "bg-emerald-100 text-emerald-800",
    rejected: "bg-red-100 text-red-700",
    lapsed: "bg-amber-100 text-amber-800",
    obsolete: "bg-gray-200 text-gray-600",
    not_held: "bg-slate-200 text-slate-700",
  };
  const label: Record<string, string> = { not_held: "not held (no quorum)" };
  return <span className={`ml-auto rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${map[status] ?? ""}`}>{label[status] ?? status}</span>;
}

export function CurrentBallot({ state }: { state: PublicForumState }) {
  const p = state.phase;
  if ((p.type !== "MOTION_VOTE" && p.type !== "VOTING_PROCEDURE") || !p.ballotId) return null;
  const b = state.ballots[p.ballotId];
  if (!b) return null;
  return (
    <div className={box}>
      <h3 className={h3}>Current vote</h3>
      <BallotSubject state={state} b={b} />
      <p className="mt-2 text-xs text-gray-600">
        {b.kind === "procedural" ? "Procedural (Yes/No)" : "Substantive (Yes/No/Abstain)"} · electorate fixed at opening: {Object.keys(b.eligible).length} · voted{" "}
        {b.voted.length}/{Object.keys(b.eligible).length}
      </p>
      <p className="text-[11px] text-gray-400">Individual choices are revealed when the vote closes.</p>
    </div>
  );
}

function BallotSubject({ state, b }: { state: PublicForumState; b: PublicBallot }) {
  if (b.subject.type === "motion") {
    const m = state.motions[b.subject.motionId];
    return m ? <p className="text-sm font-bold text-gray-800">{describeMotion(m.params)} <span className="font-normal text-gray-500">— moved by {state.seats[m.mover]?.countryName}</span></p> : null;
  }
  if (b.subject.type === "resolution") {
    const d = state.documents[b.subject.docId];
    return (
      <div>
        <p className="text-sm font-bold text-gray-800">Resolution “{d?.title}” v{b.subject.version} (text locked for this vote)</p>
        {b.status !== "closed" && d && (
          <div className="mt-1 space-y-0.5 rounded-lg bg-gray-50 p-2 text-xs text-gray-700">
            {d.preambular.map((x, i) => <p key={`p${i}`} className="italic">{x}</p>)}
            {d.operative.map((x, i) => <p key={`o${i}`}><b>{i + 1}.</b> {x}</p>)}
          </div>
        )}
      </div>
    );
  }
  if (b.subject.type === "division_proposal") {
    const pr = state.divisionProposals?.[b.subject.proposalId];
    const d = state.documents[b.subject.docId];
    return (
      <p className="text-sm font-bold text-gray-800">
        Division of “{d?.title}” — proposal by {pr ? state.seats[pr.proposer]?.countryName : ""}:{" "}
        {pr?.parts.map((x, i) => `part ${i + 1} = clause${x.clauses.length > 1 ? "s" : ""} ${x.clauses.map((n) => n + 1).join(", ")}`).join(" · ")} (rule 33, simple majority)
      </p>
    );
  }
  if (b.subject.type === "division_part") {
    const div = state.divisions?.[b.subject.docId];
    const pr = div?.adoptedProposalId ? state.divisionProposals?.[div.adoptedProposalId] : undefined;
    const clauses = pr?.parts[b.subject.part]?.clauses ?? [];
    return (
      <div>
        <p className="text-sm font-bold text-gray-800">
          Keep part {b.subject.part + 1} of “{state.documents[b.subject.docId]?.title}” in the final text? (rule 33)
        </p>
        <div className="mt-1 space-y-0.5 rounded-lg bg-gray-50 p-2 text-xs text-gray-700">
          {clauses.map((i) => (
            <p key={i}>
              <b>{i + 1}.</b> {div?.baseOperative[i]}
            </p>
          ))}
        </div>
      </div>
    );
  }
  const a = state.amendments[b.subject.amendmentId];
  return (
    <p className="text-sm font-bold text-gray-800">
      Amendment {b.subject.amendmentId} to “{a ? state.documents[a.targetDocId]?.title : ""}” — {a?.op.kind} clause {a ? a.op.clauseIndex + 1 : ""}
      {a && "text" in a.op ? `: “${a.op.text}”` : ""} (2/3 required, rule 29)
    </p>
  );
}

export function BallotResults({ state }: { state: PublicForumState }) {
  const closed = Object.values(state.ballots)
    .filter((b) => b.status === "closed" || b.status === "not_held")
    .sort((a, b) => b.openedAtMs - a.openedAtMs)
    .slice(0, 8);
  if (!closed.length) return null;
  return (
    <div className={box}>
      <h3 className={h3}>Recent results</h3>
      <ul className="space-y-2">
        {closed.map((b) => (
          <li key={b.id} className="rounded-lg border border-gray-100 p-2 text-xs" data-testid={`ballot-${b.id}`}>
            <BallotSubject state={state} b={b} />
            {b.status === "not_held" ? (
              <p className="mt-1 font-bold text-slate-600">Not held — no voting quorum (not a rejection)</p>
            ) : b.result ? (
              <p className="mt-1">
                <span className={`font-black ${b.result.passed ? "text-emerald-700" : "text-red-700"}`}>{b.result.passed ? "ADOPTED" : "NOT ADOPTED"}</span> · Yes {b.result.yes} · No {b.result.no}
                {b.kind === "substantive" && ` · Abstain ${b.result.abstain}`} · Did not vote {b.result.notVoted.length}
                {b.result.notVotedOffline.length > 0 && ` (${b.result.notVotedOffline.length} offline)`}
                <span className="block text-[10px] text-gray-400">{b.result.formula}</span>
              </p>
            ) : null}
            {b.votes && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[10px] font-bold text-gray-500">Votes by country</summary>
                <div className="mt-1 grid grid-cols-2 gap-x-3 text-[11px]">
                  {Object.keys(b.eligible)
                    .sort((x, y) => (state.seats[x]?.countryName ?? x).localeCompare(state.seats[y]?.countryName ?? y))
                    .map((s) => (
                      <span key={s}>
                        {state.seats[s]?.countryName}: <b>{b.votes?.[s] ?? (b.connectionAtClose?.[s] === "offline" ? "did not vote (offline)" : "did not vote")}</b>
                      </span>
                    ))}
                </div>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  human_voice_confirmed: "voice · confirmed",
  human_voice_auto: "voice · auto transcript",
  human_text: "typed",
  human_no_transcript: "no transcript",
  human_forfeit: "forfeit",
  ai_speech: "AI",
  ai_unavailable: "AI unavailable",
  chair: "chair",
};

export function RecordFeed({ state, record }: { state: PublicForumState; record: RecordEntry[] }) {
  return (
    <div className={box}>
      <h3 className={h3}>
        <MessageSquare size={14} className="text-brand" /> Record
      </h3>
      <div className="space-y-2">
        {record.length === 0 && <p className="text-xs text-gray-400">Nothing yet.</p>}
        {[...record].reverse().map((r) => (
          <div key={r.seq} className={`rounded-lg px-3 py-2 text-sm ${r.source === "chair" ? "bg-gray-50 text-gray-600" : r.source.startsWith("ai") ? "bg-purple-50 text-purple-900" : "bg-slate-50 text-slate-800"}`}>
            <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-gray-500">
              {r.seat && flag(r.seat)}
              {r.seat ? state.seats[r.seat]?.countryName : "Chair (automatic)"} · {SOURCE_LABEL[r.source] ?? r.source}
              <span className="ml-auto font-normal">{new Date(r.atMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            </div>
            {r.text}
          </div>
        ))}
      </div>
    </div>
  );
}
