"use client";

import { useState } from "react";
import { CheckCircle2, CircleDashed, Hand, Mic, Send, SkipForward, Timer, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { PublicForumState } from "@/engine/publicView";
import type { MotionParams, MotionType, Phase, VoteChoice } from "@/engine/types";
import { allowedChoices } from "@/engine/voting";
import { MOTION_LABEL, describeMotion, describePhase } from "@/lib/phaseText";
import type { useForumActions } from "@/hooks/useForumActions";
import { RESPONSE_ACTION } from "@/engine/responses";
import { publicResponseView } from "@/lib/meetingFlow";
import { Countdown, ExpiryWarning, Spinner } from "./Visuals";

type Props = {
  state: PublicForumState;
  mySeat: string;
  actions: ReturnType<typeof useForumActions>;
  recorder?: { status: string; detail: string };
};
/** W1 on: required responses are awaited; the old +30 s extension buttons are not used. */
const w1 = (s: PublicForumState) => (s.settings.timers.responseWaitSec ?? 0) > 0;

const box = "rounded-2xl border border-gray-100 bg-white p-4 shadow-sm";
const h3 = "mb-2 text-[11px] font-black uppercase tracking-[0.2em] text-gray-800";

/** "What can I do now?" — every button maps to one engine command; the server validates it. */
export function ActionPanel({
  state,
  mySeat,
  actions,
  recorder,
  now,
  headerAction,
  mainBottom,
  optionalTop,
  optionalBottom,
}: Props & { now: number; headerAction?: React.ReactNode; mainBottom?: React.ReactNode; optionalTop?: React.ReactNode; optionalBottom?: React.ReactNode }) {
  const p = state.phase;
  const me = state.seats[mySeat];
  const present = me.attendance === "present" || me.attendance === "present_and_voting";
  const { send, busy } = actions;
  if (p.type === "CLOSED" || p.type === "BRIEFING") return null;
  const rv = publicResponseView(state);
  const mine = !!rv?.required.includes(mySeat);
  const myDone = !!rv?.responded.includes(mySeat);
  const myStanding = !!rv?.standing.includes(mySeat);
  const speaking = p.type === "SPEECH" && p.seat === mySeat && p.speakerKind === "human";
  const status: "needed" | "optional" | "done" | "speaking" | "waiting" | "none" = speaking
    ? "speaking"
    : mine && !myDone && rv && !rv.holds
      ? "optional"
      : mine && !myDone
        ? "needed"
      : mine && myDone
        ? "done"
        : rv && rv.pending.length > 0 && rv.holds
          ? "waiting"
          : "none";
  if (state.paused)
    return (
      <div className={box}>
        <p className="text-sm text-gray-600">
          {state.paused.reason === "no_humans"
            ? "The meeting was on hold because no human delegate was online (app policy H1). It continues now that you are connected."
            : "The app is paused by the room owner. Actions resume automatically."}
        </p>
      </div>
    );

  const head = {
    needed: { cls: "border-amber-300 bg-amber-50", icon: <Hand size={18} className="text-amber-700" />, title: "Your response is needed", sub: rv ? RESPONSE_ACTION[rv.kind] : "" },
    optional: { cls: "border-brand/30 bg-brand-light", icon: <CircleDashed size={18} className="text-brand" />, title: "Negotiation in progress", sub: "Optional: click “Ready to resume” when you are done. The caucus ends at its adopted time, or earlier once every human is ready." },
    done: myStanding
      ? {
          cls: "border-emerald-200 bg-emerald-50",
          icon: <CheckCircle2 size={18} className="text-emerald-700" />,
          title: "Your “no motion” still stands",
          sub: "Nothing has changed since you said you had no motion, so you are not asked again. You can still move a motion while the window is open.",
        }
      : { cls: "border-emerald-200 bg-emerald-50", icon: <CheckCircle2 size={18} className="text-emerald-700" />, title: "Done — waiting for others", sub: rv && rv.pending.length ? `${rv.pending.length} other delegate${rv.pending.length > 1 ? "s" : ""} still to respond` : "Waiting for the AI delegations / step timer" },
    speaking: { cls: "border-red-200 bg-red-50", icon: <Mic size={18} className="text-red-700" />, title: "You have the floor", sub: "Speak now; end your speech when you are finished" },
    waiting: { cls: "border-gray-200 bg-gray-50", icon: <CircleDashed size={18} className="text-gray-500" />, title: "No action needed from you", sub: "Waiting for other delegates to respond" },
    none: { cls: "border-gray-200 bg-gray-50", icon: <UserCheck size={18} className="text-gray-500" />, title: "No action needed right now", sub: "You can still use the optional actions below" },
  }[status];

  const overBase = !!rv?.wait && now >= rv.wait.baseDeadlineMs;
  return (
    <div className={box} data-testid="my-action">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className={`${h3} mb-0`}>Your actions — {me.countryName}</h3>
        {headerAction}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0 space-y-4" data-testid="main-actions">
      <div className={`rounded-xl border-2 p-3 ${head.cls} ${status === "needed" ? "respond-pulse" : ""}`} data-testid={`my-status-${status}`}>
        <div className="flex items-start gap-2">
          {head.icon}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-gray-900">{head.title}</p>
            <p className="text-xs text-gray-600">{head.sub}</p>
          </div>
          {status === "needed" && rv?.wait && (overBase ? <Spinner label="Waiting for your response" /> : <Countdown atMs={rv.wait.baseDeadlineMs} now={now} size="md" warn={false} />)}
        </div>
        {status === "needed" && rv && <div className="mt-2"><ExpiryWarning rv={rv} now={now} /></div>}
      </div>

      {!present && (
        <div className="space-y-2">
          <p className="text-xs text-gray-600">You are not recorded as present. Declare attendance to speak, move motions and vote (rule 31).</p>
          <div className="flex flex-wrap gap-2">
            <Button size="md" disabled={busy} onClick={() => void send({ type: "declare_attendance", seat: mySeat, value: "present" })}>
              Present
            </Button>
            <Button size="md" variant="secondary" disabled={busy} onClick={() => void send({ type: "declare_attendance", seat: mySeat, value: "present_and_voting" })}>
              Present and voting
            </Button>
          </div>
          <p className="text-[11px] text-gray-400">“Present and voting” cannot abstain on substantive votes and cannot be withdrawn.</p>
        </div>
      )}

      {present && <SpeakerControls state={state} mySeat={mySeat} actions={actions} recorder={recorder} part="speech" />}
      {present && p.type === "FLOOR_OPEN" && <FloorControls state={state} mySeat={mySeat} actions={actions} />}
      {present && p.type === "VP_FLOOR" && <VotingMotionControls state={state} mySeat={mySeat} actions={actions} />}
      {present && p.type === "DIVISION_PROPOSALS" && <DivisionControls state={state} mySeat={mySeat} actions={actions} />}
      {present && (p.type === "MOTION_VOTE" || p.type === "VOTING_PROCEDURE") && <VoteControls state={state} mySeat={mySeat} actions={actions} />}
      {present && p.type === "MOD_CAUCUS" && (
        <div className="space-y-2" data-testid="volunteer-controls">
          <p className="text-xs text-gray-600">
            Speaking turn {(state.activeCaucus?.spokenSeats.length ?? 0) + 1} of this moderated caucus · topic “{state.activeCaucus?.topic}”.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="md" disabled={busy || p.volunteers.includes(mySeat)} onClick={() => void send({ type: "volunteer", seat: mySeat }, { phaseId: state.phaseId })}>
              <Hand size={14} className="mr-1" /> {p.volunteers.includes(mySeat) ? "Volunteered ✓" : "Volunteer to speak"}
            </Button>
            {!p.volunteers.includes(mySeat) && (
              <Button size="md" variant="secondary" disabled={busy || (p.passed ?? []).includes(mySeat)} onClick={() => void send({ type: "volunteer_pass", seat: mySeat }, { phaseId: state.phaseId })}>
                {(p.passed ?? []).includes(mySeat) ? "Passed this turn ✓" : "Pass this turn"}
              </Button>
            )}
          </div>
          <p className="text-[11px] text-gray-500">Pass applies to this speaking turn only — you can volunteer or pass again next turn.</p>
        </div>
      )}
      {present && p.type === "AMENDMENT_SPONSOR_RESPONSE" && mine && !myDone && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3" data-testid="sponsor-response">
          <p className="text-sm font-black text-amber-900">You sponsor the resolution: accept amendment {p.amendmentId} as friendly?</p>
          <p className="text-xs text-amber-800">{(() => { const a = state.amendments[p.amendmentId]; return a ? `${a.op.kind} clause ${a.op.clauseIndex + 1}${"text" in a.op ? `: “${a.op.text}”` : ""}` : ""; })()}</p>
          <div className="flex gap-2">
            <Button size="md" disabled={busy} onClick={() => void send({ type: "sponsor_response", seat: mySeat, amendmentId: p.amendmentId, agree: true })}>Accept (friendly)</Button>
            <Button size="md" variant="outline" disabled={busy} onClick={() => void send({ type: "sponsor_response", seat: mySeat, amendmentId: p.amendmentId, agree: false })}>Object</Button>
          </div>
        </div>
      )}
      {present && p.type === "UNMOD_CAUCUS" && (
        <div className="space-y-1">
          <p className="text-xs text-gray-600">Formal debate is suspended. Talk freely and work on documents and amendments below.</p>
          <Button size="sm" variant="secondary" disabled={busy || p.readySeats.includes(mySeat)} onClick={() => void send({ type: "caucus_ready", seat: mySeat })}>
            {p.readySeats.includes(mySeat) ? "Ready" : "Ready to resume"}
          </Button>
        </div>
      )}
      {actions.error && <p className="text-xs font-semibold text-red-600" role="alert">{actions.error}</p>}
      {mainBottom}
      </div>
      <div className="min-w-0 space-y-3 border-t border-gray-100 pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0" data-testid="optional-actions">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Optional</p>
        {optionalTop}
        {present && <SpeakerControls state={state} mySeat={mySeat} actions={actions} recorder={recorder} part="signup" />}
        {present && me.attendance !== "present_and_voting" && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void send({ type: "declare_attendance", seat: mySeat, value: "present_and_voting" })}>
              Change to “Present and voting”
            </Button>
            <span className="text-[11px] text-gray-400">cannot abstain on substantive votes; cannot be withdrawn</span>
          </div>
        )}
        {p.type !== "LOBBY" && <PointsControls state={state} mySeat={mySeat} actions={actions} />}
        {optionalBottom}
      </div>
      </div>
    </div>
  );
}

/** Rules 20–22 as adapted: personal privilege is recorded; inquiry and order are answered from the rules and engine checks. */
function PointsControls({ state, mySeat, actions }: Props) {
  const [text, setText] = useState("");
  const { send, busy } = actions;
  const info = describePhase(state);
  return (
    <details className="rounded-xl border border-gray-100 p-3 text-xs" data-testid="points">
      <summary className="cursor-pointer font-bold text-gray-700">Points (personal privilege · parliamentary inquiry · order)</summary>
      <div className="mt-2 space-y-3">
        <div className="space-y-1">
          <p className="font-bold text-gray-800">Point of personal privilege (rule 20)</p>
          <p className="text-gray-500">Report a problem affecting your participation (audio, connection). It is shown to everyone in the record.</p>
          <div className="flex gap-2">
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="e.g. I cannot hear the speaker" className="flex-1 rounded-lg border border-gray-200 p-2" />
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !text.trim()}
              onClick={async () => {
                if (await send({ type: "raise_point", seat: mySeat, kind: "personal_privilege", text })) setText("");
              }}
            >
              Raise
            </Button>
          </div>
        </div>
        <div className="space-y-1">
          <p className="font-bold text-gray-800">Point of parliamentary inquiry (rule 22)</p>
          <p className="text-gray-600">
            <b>Now:</b> {info.title}. {info.detail} <b>Next:</b> {info.next}
          </p>
        </div>
        <div className="space-y-1">
          <p className="font-bold text-gray-800">Point of order (rule 21)</p>
          <p className="text-gray-600">The automatic chair checks every motion, vote and speech against the rules before applying it; an out-of-order action is refused with the rule cited (shown below the buttons).</p>
        </div>
      </div>
    </details>
  );
}

/** Rules 33–34: motions taken in voting procedure. */
function VotingMotionControls({ state, mySeat, actions }: Props) {
  const p = state.phase as Extract<Phase, { type: "VP_FLOOR" }>;
  const { send, busy } = actions;
  const [order, setOrder] = useState<string[]>(state.votingOrder ?? []);
  const ready = p.readySeats.includes(mySeat);
  const move = (i: number, d: number) => {
    const o = [...order];
    const j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    setOrder(o);
  };
  const mine = Object.values(state.motions).filter((m) => m.windowId === p.windowId && m.status === "pending");
  return (
    <div className="space-y-2 rounded-xl border border-brand/20 bg-brand/5 p-3" data-testid="vp-floor">
      {p.target.kind === "order" ? (
        <>
          <p className="text-sm font-black text-brand">Move to reorder the resolutions (rule 34)</p>
          <ol className="space-y-1">
            {order.map((id, i) => (
              <li key={id} className="flex items-center gap-2 text-sm">
                <span className="w-5 font-bold">{i + 1}.</span>
                <span className="flex-1">{state.documents[id]?.title}</span>
                <Button size="sm" variant="outline" disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </Button>
                <Button size="sm" variant="outline" disabled={i === order.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </Button>
              </li>
            ))}
          </ol>
          <Button size="sm" disabled={busy || order.join() === (state.votingOrder ?? []).join()} onClick={() => void send({ type: "submit_motion", seat: mySeat, params: { type: "reorder_resolutions", order } }, { phaseId: state.phaseId })}>
            Propose this order
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm font-black text-brand">Move to divide the question (rule 33)</p>
          <p className="text-xs text-gray-600">If adopted, delegations propose which operative clauses to vote separately. Preambular clauses cannot be divided.</p>
          <Button size="sm" disabled={busy} onClick={() => void send({ type: "submit_motion", seat: mySeat, params: { type: "divide_question", docId: p.target.kind === "division" ? p.target.docId : "" } }, { phaseId: state.phaseId })}>
            Move to divide “{p.target.kind === "division" ? state.documents[p.target.docId]?.title : ""}”
          </Button>
        </>
      )}
      {mine.length > 0 && (
        <ul className="text-xs text-gray-600">
          {mine.map((m) => (
            <li key={m.id}>
              • {describeMotion(m.params)}
              {m.params.type === "reorder_resolutions" ? `: ${m.params.order.map((id) => state.documents[id]?.title).join(" → ")}` : ""} — {state.seats[m.mover]?.countryName}
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" variant="secondary" disabled={busy || ready} onClick={() => void send({ type: "floor_pass", seat: mySeat }, { phaseId: state.phaseId })}>
        {ready ? "Done ✓" : "No motion — I'm done"}
      </Button>
    </div>
  );
}

function DivisionControls({ state, mySeat, actions }: Props) {
  const p = state.phase as Extract<Phase, { type: "DIVISION_PROPOSALS" }>;
  const { send, busy } = actions;
  const div = state.divisions?.[p.docId];
  const clauses = div?.baseOperative ?? [];
  const [sel, setSel] = useState<number[]>([]);
  const ready = p.readySeats.includes(mySeat);
  const proposals = (div?.proposals ?? []).map((id) => state.divisionProposals?.[id]).filter(Boolean);
  return (
    <div className="space-y-2 rounded-xl border border-brand/20 bg-brand/5 p-3" data-testid="division-proposals">
      <p className="text-sm font-black text-brand">Propose a division</p>
      <p className="text-xs text-gray-600">Tick the operative clauses to vote separately. The other clauses form a second part.</p>
      <div className="space-y-1">
        {clauses.map((c, i) => (
          <label key={i} className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={sel.includes(i)} onChange={(e) => setSel(e.target.checked ? [...sel, i] : sel.filter((x) => x !== i))} />
            <span>
              <b>{i + 1}.</b> {c}
            </span>
          </label>
        ))}
      </div>
      <Button size="sm" disabled={busy || sel.length === 0 || sel.length === clauses.length} onClick={async () => {
        if (await send({ type: "submit_division_proposal", seat: mySeat, docId: p.docId, parts: [sel] }, { phaseId: state.phaseId })) setSel([]);
      }}>
        Propose: clauses {sel.map((x) => x + 1).sort((a, b) => a - b).join(", ") || "—"} separately
      </Button>
      {proposals.length > 0 && (
        <ul className="text-xs text-gray-600">
          {proposals.map((x) => (
            <li key={x!.id}>
              • {state.seats[x!.proposer]?.countryName}: {x!.parts.map((g) => g.clauses.map((n) => n + 1).join("+")).join(" | ")}
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" variant="secondary" disabled={busy || ready} onClick={() => void send({ type: "floor_pass", seat: mySeat }, { phaseId: state.phaseId })}>
        {ready ? "Done ✓" : "No proposal — I'm done"}
      </Button>
    </div>
  );
}

function SpeakerControls({ state, mySeat, actions, recorder, part }: Props & { part: "speech" | "signup" }) {
  const p = state.phase;
  const { send, busy } = actions;
  const [text, setText] = useState("");
  const inList = state.speakersList.includes(mySeat);
  const pos = state.speakersList.indexOf(mySeat);
  const mySpeech = p.type === "SPEECH" && p.seat === mySeat && p.speakerKind === "human";
  const myConfirm = p.type === "SPEECH_CONFIRM" && p.seat === mySeat;

  return (
    <div className="space-y-2">
      {part === "signup" && !state.debateClosed && !mySpeech && !myConfirm && (
        <div className="flex items-center gap-2">
          {inList ? (
            <>
              <span className="text-xs font-bold text-brand">On the speakers’ list (#{pos + 1})</span>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void send({ type: "remove_from_speakers_list", seat: mySeat })}>
                Withdraw
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void send({ type: "add_to_speakers_list", seat: mySeat })}>
              <Hand size={14} className="mr-1" /> Add me to the speakers’ list
            </Button>
          )}
        </div>
      )}
      {/* Recognised / speaking: handled by the full-width SpeechFocus screen (Room). */}
      {part === "speech" && myConfirm && p.type === "SPEECH_CONFIRM" && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-black text-amber-900">Confirm what enters the record</p>
          <p className="text-xs text-amber-800">
            {p.transcript.status === "pending"
              ? recorder?.status === "uploading"
                ? "Transcribing your speech… You can also type it, or skip."
                : "Waiting for the transcript. You can type your statement instead, or skip."
              : p.transcript.status === "failed"
                ? "Transcription failed. Type your statement, or skip."
                : "Edit the transcript if needed, then confirm."}
          </p>
          <textarea
            value={text || (p.transcript.text ?? "")}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-amber-200 bg-white p-2 text-sm"
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !(text || p.transcript.text)} onClick={() => void send({ type: "confirm_transcript", seat: mySeat, text: text || p.transcript.text || "" })}>
              <Send size={13} className="mr-1" /> Confirm
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void send({ type: "skip_transcript", seat: mySeat })}>
              <SkipForward size={13} className="mr-1" /> Skip (no transcript)
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}


const MOTION_CHOICES: MotionType[] = ["mod_caucus", "unmod_caucus", "extend_caucus", "set_speaking_time", "suspend", "adjourn", "introduce_resolution", "introduce_amendment", "enter_voting"];

function FloorControls({ state, mySeat, actions }: Props) {
  const p = state.phase as Extract<Phase, { type: "FLOOR_OPEN" }>;
  const { send, busy } = actions;
  const [type, setType] = useState<MotionType>("mod_caucus");
  const [topic, setTopic] = useState("");
  const [speakingSec, setSpeakingSec] = useState(60);
  const [totalMin, setTotalMin] = useState(5);
  const [durMin, setDurMin] = useState(2);
  const draftAmendments = Object.values(state.amendments).filter((a) => a.status === "draft");
  const [amendmentId, setAmendmentId] = useState("");
  const ready = p.readySeats.includes(mySeat);

  const params = (): MotionParams => {
    switch (type) {
      case "mod_caucus":
        return { type, topic, speakingSec, totalSec: totalMin * 60 };
      case "unmod_caucus":
        return { type, totalSec: totalMin * 60 };
      case "extend_caucus":
      case "suspend":
        return { type, durationSec: durMin * 60 };
      case "set_speaking_time":
        return { type, speakingSec };
      case "introduce_amendment":
        return { type, amendmentId: amendmentId || draftAmendments[0]?.id || "" };
      case "adjourn":
      case "introduce_resolution":
      case "enter_voting":
        return { type };
      default:
        return { type: "adjourn" };
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-brand/20 bg-brand/5 p-3">
      <p className="text-sm font-black text-brand">Floor is open — move a motion</p>
      {(p.standingSeats ?? []).includes(mySeat) && !ready && (
        <p className="rounded-lg bg-emerald-50 px-2 py-1.5 text-xs text-emerald-800" data-testid="standing-no-motion">
          Your earlier “no motion” still stands — nothing has changed, so you do not need to answer again. Move a motion if you want; otherwise this window simply runs its normal time.
        </p>
      )}
      <select value={type} onChange={(e) => setType(e.target.value as MotionType)} className="w-full rounded-lg border border-gray-200 p-2 text-sm">
        {MOTION_CHOICES.map((m) => (
          <option key={m} value={m}>
            {MOTION_LABEL[m]}
          </option>
        ))}
      </select>
      {type === "introduce_amendment" && (
        <select value={amendmentId} onChange={(e) => setAmendmentId(e.target.value)} className="w-full rounded-lg border border-gray-200 p-2 text-sm">
          {draftAmendments.length === 0 && <option value="">No amendment drafted yet (see Documents)</option>}
          {draftAmendments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id} → {state.documents[a.targetDocId]?.title} ({a.op.kind} clause {a.op.clauseIndex + 1}, {a.signatories.length} signatories)
            </option>
          ))}
        </select>
      )}
      {type === "mod_caucus" && <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic" className="w-full rounded-lg border border-gray-200 p-2 text-sm" />}
      {(type === "mod_caucus" || type === "set_speaking_time") && (
        <label className="flex items-center gap-2 text-xs text-gray-600">
          Speaking time (s)
          <input type="number" min={15} max={180} value={speakingSec} onChange={(e) => setSpeakingSec(Number(e.target.value))} className="w-20 rounded border border-gray-200 p-1" />
        </label>
      )}
      {(type === "mod_caucus" || type === "unmod_caucus") && (
        <label className="flex items-center gap-2 text-xs text-gray-600">
          Total (min)
          <input type="number" min={1} max={20} value={totalMin} onChange={(e) => setTotalMin(Number(e.target.value))} className="w-20 rounded border border-gray-200 p-1" />
        </label>
      )}
      {(type === "extend_caucus" || type === "suspend") && (
        <label className="flex items-center gap-2 text-xs text-gray-600">
          Duration (min)
          <input type="number" min={0.5} step={0.5} max={10} value={durMin} onChange={(e) => setDurMin(Number(e.target.value))} className="w-20 rounded border border-gray-200 p-1" />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void send({ type: "submit_motion", seat: mySeat, params: params() }, { phaseId: state.phaseId })}>
          Submit motion
        </Button>
        <Button size="sm" variant="secondary" disabled={busy || ready} onClick={() => void send({ type: "floor_pass", seat: mySeat }, { phaseId: state.phaseId })}>
          {ready ? "Done ✓" : "No motion — I'm done"}
        </Button>
        {!w1(state) && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void send({ type: "request_extension", seat: mySeat })}>
            <Timer size={13} className="mr-1" /> +30 s
          </Button>
        )}
      </div>
      <p className="text-[11px] text-gray-500">
        {w1(state)
          ? "Moving a motion also counts as your response (you can add another while the window is open). The window closes when every human delegate has responded and the AI delegations are done."
          : "The window stays open for its full time unless every online delegate is ready. AI motions never close it early."}
      </p>
    </div>
  );
}

function VoteControls({ state, mySeat, actions }: Props) {
  const p = state.phase as Extract<Phase, { type: "MOTION_VOTE" | "VOTING_PROCEDURE" }>;
  const { send, busy } = actions;
  if (!p.ballotId) return null;
  const b = state.ballots[p.ballotId];
  if (!b) return null;
  if (!b.eligible[mySeat]) return <p className="text-xs text-gray-500">You were not present when this vote opened, so you cannot vote on it (rule 32 / D10).</p>;
  if (p.stage === "reading") return <p className="text-sm font-bold text-gray-700">Read the item — voting opens when the reading time ends.</p>;
  const voted = b.voted.includes(mySeat);
  const choices = allowedChoices({ ...b, votes: {} }, mySeat) as VoteChoice[];
  const textHash = "textHash" in b.subject ? b.subject.textHash : undefined;
  return (
    <div className="space-y-2 rounded-xl border border-gray-200 p-3">
      <p className="text-sm font-black text-gray-800">{voted ? "Your vote is recorded" : "Cast your vote"}</p>
      {!voted && (
        <div className="flex flex-wrap gap-2">
          {choices.map((c) => (
            <Button key={c} size="sm" variant={c === "yes" ? "primary" : c === "no" ? "secondary" : "outline"} disabled={busy} onClick={() => void send({ type: "cast_vote", seat: mySeat, ballotId: b.id, choice: c }, { ballotId: b.id, textHash })}>
              {c === "yes" ? "Yes" : c === "no" ? "No" : "Abstain"}
            </Button>
          ))}
          {!w1(state) && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void send({ type: "request_extension", seat: mySeat })}>
              <Timer size={13} className="mr-1" /> +30 s
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
