"use client";


import { Bot, Crown, ListOrdered, MessageSquare, Mic, PauseCircle, Timer, User, Users, Vote, WifiOff } from "lucide-react";
import type { PublicBallot, PublicForumState } from "@/engine/publicView";
import type { RecordEntry } from "@/engine/types";
import { describeMotion } from "@/lib/phaseText";
import { Flag, KindBadge, VoteChart } from "./Visuals";

const box = "rounded-2xl border border-gray-100 bg-white p-4 shadow-sm";
const h3 = "mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-gray-800";
const flag = (c: string) => <img src={`https://flagcdn.com/w40/${c}.png`} alt="" className="h-3.5 w-5 shrink-0 rounded-sm object-cover" />;

/** D. General speakers' list (kept through caucuses) and, separately, moderated-caucus volunteers. */
export function SpeakersList({ state }: { state: PublicForumState }) {
  const p = state.phase;
  const inCaucus = !!state.activeCaucus;
  const listSpeaker = (p.type === "SPEECH" || p.type === "SPEECH_PREP" || p.type === "AI_SPEECH_PENDING" || p.type === "SPEECH_CONFIRM") && (p.context.kind === "speakers_list" || p.context.kind === "yield") ? p.seat : null;
  const volunteers = p.type === "MOD_CAUCUS" ? p.volunteers : [];
  return (
    <div className={box} data-testid="speakers-list">
      <h3 className={h3}>
        <ListOrdered size={14} className="text-brand" /> General speakers’ list · {state.speakingTimeSec}s each
      </h3>
      {inCaucus && (
        <p className="mb-2 flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800">
          <PauseCircle size={12} /> Paused — resumes after the {state.activeCaucus!.kind === "mod" ? "moderated" : "unmoderated"} caucus
        </p>
      )}
      {state.debateClosed ? (
        <p className="text-xs text-gray-400">Closed (voting procedure).</p>
      ) : (
        <ol className="space-y-1">
          {listSpeaker && (
            <li className="flex items-center gap-2 rounded-lg bg-red-50 px-2 py-1 text-sm ring-1 ring-red-200">
              <Mic size={13} className="text-red-600" />
              <Flag code={listSpeaker} />
              <span className="font-black text-gray-900">{state.seats[listSpeaker]?.countryName}</span>
              <span className="ml-auto text-[10px] font-black uppercase text-red-600">now</span>
            </li>
          )}
          {state.speakersList.map((id, i) => (
            <li key={id} className={`flex items-center gap-2 px-2 py-0.5 text-sm ${inCaucus ? "opacity-60" : ""}`}>
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[10px] font-black text-gray-600">{i + 1}</span>
              <Flag code={id} />
              <span className="font-bold text-gray-800">{state.seats[id]?.countryName}</span>
              {state.seats[id] && <span className="ml-auto"><KindBadge seat={state.seats[id]} /></span>}
            </li>
          ))}
          {!listSpeaker && state.speakersList.length === 0 && <p className="text-xs text-gray-400">Nobody is waiting to speak.</p>}
        </ol>
      )}
      {p.type === "MOD_CAUCUS" && (
        <div className="mt-3 border-t border-gray-100 pt-2" data-testid="caucus-volunteers">
          <p className="mb-1 text-[11px] font-black uppercase tracking-widest text-gray-500">
            Moderated caucus · “{state.activeCaucus?.topic}” · volunteers this round
          </p>
          {volunteers.length === 0 ? (
            <p className="text-xs text-gray-400">No volunteers yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {volunteers.map((id) => (
                <li key={id} className="flex items-center gap-1 rounded-full border border-gray-200 px-2 py-0.5 text-xs font-bold">
                  <Flag code={id} className="h-3 w-4" /> {state.seats[id]?.countryName}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-[10px] text-gray-400">Delegations that have not spoken in this caucus go first, humans before AI (app policy).</p>
        </div>
      )}
    </div>
  );
}

/** Seats: human/AI, attendance, connection, who holds the floor. */
export function SeatGrid({ state, mySeat }: { state: PublicForumState; mySeat: string }) {
  const seats = Object.values(state.seats).sort((a, b) => (a.kind === b.kind ? a.countryName.localeCompare(b.countryName) : a.kind === "human" ? -1 : 1));
  const speaking = "seat" in state.phase ? (state.phase as { seat: string }).seat : null;
  const humans = seats.filter((x) => x.kind === "human").length;
  const present = seats.filter((x) => x.attendance !== "not_recorded").length;
  return (
    <div className={box} data-testid="seat-grid">
      <h3 className={h3}>
        <Users size={14} className="text-brand" /> Delegations · {humans} human · {seats.length - humans} AI · {present}/{seats.length} present
      </h3>
      <div className="grid grid-cols-2 gap-1.5">
        {seats.map((s) => {
          const isPresent = s.attendance !== "not_recorded";
          return (
            <div
              key={s.id}
              className={`relative flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs ${s.id === speaking ? "border-red-300 bg-red-50 ring-1 ring-red-200" : s.id === mySeat ? "border-brand/40 bg-brand/5" : "border-gray-100"} ${isPresent ? "" : "opacity-50"}`}
              title={`${s.countryName} — ${s.kind === "ai" ? "AI" : "human"} · ${s.attendance === "present_and_voting" ? "present and voting" : isPresent ? "present" : "not recorded"}${s.kind === "human" ? ` · ${s.connection}` : ""}`}
            >
              <Flag code={s.id} />
              <span className="min-w-0 flex-1 truncate font-bold text-gray-800">{s.countryName}</span>
              {s.kind === "ai" ? <Bot size={12} className="text-purple-600" aria-label="AI" /> : s.uid === state.ownerUid ? <Crown size={12} className="text-brand" aria-label="room owner" /> : <User size={12} className="text-brand" aria-label="human" />}
              {s.kind === "human" && (s.connection === "offline" ? <WifiOff size={11} className="text-gray-400" aria-label="offline" /> : <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-label="online" />)}
              <span className="text-[9px] font-black uppercase text-gray-400">{s.attendance === "present_and_voting" ? "P&V" : isPresent ? "P" : "–"}</span>
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
  if (!windowId)
    return (
      <div className={box} data-testid="floor-motions">
        <h3 className={h3}>
          <Vote size={14} className="text-brand" /> Motions on the floor
        </h3>
        <p className="text-xs text-gray-400">No motion window is open.</p>
      </div>
    );
  const list = Object.values(state.motions)
    .filter((m) => m.windowId === windowId)
    .sort((a, b) => a.submittedAtMs - b.submittedAtMs);
  return (
    <div className={box} data-testid="floor-motions">
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
    <div className={box} data-testid="current-ballot">
      <h3 className={h3}>
        <Vote size={14} className="text-brand" /> Current vote · {b.kind === "procedural" ? "procedural (Yes/No)" : "substantive (Yes/No/Abstain)"}
      </h3>
      <BallotSubject state={state} b={b} />
      <div className="mt-3">
        <VoteChart state={state} b={b} />
      </div>
    </div>
  );
}

export function BallotSubject({ state, b }: { state: PublicForumState; b: PublicBallot }) {
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

export function BallotResults({ state, all = false }: { state: PublicForumState; all?: boolean }) {
  const every = Object.values(state.ballots)
    .filter((b) => b.status === "closed" || b.status === "not_held")
    .sort((a, b) => b.openedAtMs - a.openedAtMs);
  const item = (b: PublicBallot) => (
    <li key={b.id} className="rounded-lg border border-gray-100 p-2 text-xs" data-testid={`ballot-${b.id}`}>
      <BallotSubject state={state} b={b} />
      <div className="mt-2">
        <VoteChart state={state} b={b} compact />
        {b.result && b.result.notVotedOffline.length > 0 && <p className="text-[10px] text-gray-500">{b.result.notVotedOffline.length} of the non-voters were offline.</p>}
      </div>
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
  );
  return (
    <div className={box} data-testid="recent-results">
      <h3 className={h3}>Recent results</h3>
      {every.length === 0 ? (
        <p className="text-xs text-gray-400">No vote has been held yet.</p>
      ) : all ? (
        <ul className="space-y-2">{every.map(item)}</ul>
      ) : (
        <>
          <ul className="space-y-2">{item(every[0])}</ul>
          {every.length > 1 && (
            <details className="mt-2" data-testid="previous-results">
              <summary className="cursor-pointer text-xs font-bold text-brand">Previous results ({every.length - 1})</summary>
              <ul className="mt-2 space-y-2">{every.slice(1).map(item)}</ul>
            </details>
          )}
        </>
      )}
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
          <div key={r.seq} className={`rounded-lg px-3 py-2 text-sm ${r.kind === "response_timeout" ? "border border-amber-200 bg-amber-50 text-amber-900" : r.source === "chair" ? "bg-gray-50 text-gray-600" : r.source.startsWith("ai") ? "bg-purple-50 text-purple-900" : "bg-slate-50 text-slate-800"}`} data-kind={r.kind}>
            <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-gray-500">
              {r.kind === "response_timeout" && <span className="flex items-center gap-0.5 rounded bg-amber-200 px-1 text-amber-900"><Timer size={10} /> automatic step</span>}
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
