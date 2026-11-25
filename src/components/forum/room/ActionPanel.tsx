"use client";

import { useState } from "react";
import { Hand, Mic, Send, SkipForward, Timer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { PublicForumState } from "@/engine/publicView";
import type { MotionParams, MotionType, Phase, VoteChoice } from "@/engine/types";
import { allowedChoices } from "@/engine/voting";
import { MOTION_LABEL } from "@/lib/phaseText";
import type { useForumActions } from "@/hooks/useForumActions";

type Props = {
  state: PublicForumState;
  mySeat: string;
  actions: ReturnType<typeof useForumActions>;
  recorder?: { status: string; detail: string };
};

const box = "rounded-2xl border border-gray-100 bg-white p-4 shadow-sm";
const h3 = "mb-2 text-[11px] font-black uppercase tracking-[0.2em] text-gray-800";

/** "What can I do now?" — every button maps to one engine command; the server validates it. */
export function ActionPanel({ state, mySeat, actions, recorder }: Props) {
  const p = state.phase;
  const me = state.seats[mySeat];
  const present = me.attendance === "present" || me.attendance === "present_and_voting";
  const { send, busy } = actions;
  if (p.type === "CLOSED") return null;
  if (state.paused) return <div className={box}><p className="text-sm text-gray-600">The app is paused by the room owner. Actions resume automatically.</p></div>;

  return (
    <div className={`${box} space-y-4`}>
      <h3 className={h3}>Your actions — {me.countryName}</h3>

      {me.attendance !== "present_and_voting" && (
        <div className="space-y-2">
          {!present && <p className="text-xs text-gray-600">You are not recorded as present. Declare attendance to speak, move motions and vote (rule 31).</p>}
          <div className="flex flex-wrap gap-2">
            {!present && (
              <Button size="sm" disabled={busy} onClick={() => void send({ type: "declare_attendance", seat: mySeat, value: "present" })}>
                Present
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void send({ type: "declare_attendance", seat: mySeat, value: "present_and_voting" })}>
              Present and voting
            </Button>
          </div>
          <p className="text-[11px] text-gray-400">“Present and voting” cannot abstain on substantive votes and cannot be withdrawn.</p>
        </div>
      )}

      {present && <SpeakerControls state={state} mySeat={mySeat} actions={actions} recorder={recorder} />}
      {present && p.type === "FLOOR_OPEN" && <FloorControls state={state} mySeat={mySeat} actions={actions} />}
      {present && (p.type === "MOTION_VOTE" || p.type === "VOTING_PROCEDURE") && <VoteControls state={state} mySeat={mySeat} actions={actions} />}
      {present && p.type === "MOD_CAUCUS" && (
        <Button size="sm" disabled={busy || p.volunteers.includes(mySeat)} onClick={() => void send({ type: "volunteer", seat: mySeat }, { phaseId: state.phaseId })}>
          <Hand size={14} className="mr-1" /> {p.volunteers.includes(mySeat) ? "Volunteered" : "Volunteer to speak"}
        </Button>
      )}
      {present && p.type === "UNMOD_CAUCUS" && (
        <div className="space-y-1">
          <p className="text-xs text-gray-600">Formal debate is suspended. Talk freely. (Shared documents arrive in Phase 6.)</p>
          <Button size="sm" variant="secondary" disabled={busy || p.readySeats.includes(mySeat)} onClick={() => void send({ type: "caucus_ready", seat: mySeat })}>
            {p.readySeats.includes(mySeat) ? "Ready" : "Ready to resume"}
          </Button>
        </div>
      )}
      {actions.error && <p className="text-xs font-semibold text-red-600">{actions.error}</p>}
    </div>
  );
}

function SpeakerControls({ state, mySeat, actions, recorder }: Props) {
  const p = state.phase;
  const { send, busy } = actions;
  const [text, setText] = useState("");
  const inList = state.speakersList.includes(mySeat);
  const pos = state.speakersList.indexOf(mySeat);
  const mySpeech = p.type === "SPEECH" && p.seat === mySeat && p.speakerKind === "human";
  const myConfirm = p.type === "SPEECH_CONFIRM" && p.seat === mySeat;
  const myPrep = p.type === "SPEECH_PREP" && p.seat === mySeat;

  return (
    <div className="space-y-2">
      {!state.debateClosed && !mySpeech && !myConfirm && (
        <div className="flex items-center gap-2">
          {inList ? (
            <>
              <span className="text-xs font-bold text-brand">On the speakers’ list (#{pos + 1})</span>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void send({ type: "remove_from_speakers_list", seat: mySeat })}>
                Withdraw
              </Button>
            </>
          ) : (
            <Button size="sm" disabled={busy} onClick={() => void send({ type: "add_to_speakers_list", seat: mySeat })}>
              <Hand size={14} className="mr-1" /> Add me to the speakers’ list
            </Button>
          )}
        </div>
      )}
      {myPrep && <p className="rounded-lg bg-brand-light px-3 py-2 text-sm font-bold text-brand">You are next — get ready. Your microphone opens when your time starts.</p>}
      {mySpeech && (
        <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="flex items-center gap-1 text-sm font-black text-red-700">
            <Mic size={14} /> You have the floor
          </p>
          <p className="text-xs text-red-800">
            {recorder?.status === "recording"
              ? "Recording your microphone for the transcript (your live audio reaches others via the video session)."
              : recorder?.status === "unavailable" || recorder?.detail
                ? recorder.detail
                : "Preparing microphone…"}
          </p>
          <Button size="sm" disabled={busy} onClick={() => void send({ type: "end_speech", seat: mySeat }, { phaseId: state.phaseId })}>
            End speech
          </Button>
          <TextSpeech text={text} setText={setText} label="No microphone? Submit your speech as text instead" onSubmit={() => send({ type: "submit_text_speech", seat: mySeat, text })} busy={busy} />
        </div>
      )}
      {myConfirm && p.type === "SPEECH_CONFIRM" && (
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

function TextSpeech({ text, setText, label, onSubmit, busy }: { text: string; setText: (s: string) => void; label: string; onSubmit: () => Promise<boolean>; busy: boolean }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer font-bold text-gray-600">{label}</summary>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-gray-200 p-2 text-sm" />
      <Button size="sm" className="mt-1" disabled={busy || !text.trim()} onClick={() => void onSubmit()}>
        Submit text speech
      </Button>
    </details>
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
          {ready ? "Ready ✓" : "I'm done (ready)"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void send({ type: "request_extension", seat: mySeat })}>
          <Timer size={13} className="mr-1" /> +30 s
        </Button>
      </div>
      <p className="text-[11px] text-gray-500">
        The window stays open for its full time unless every online delegate is ready. AI motions never close it early.
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
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void send({ type: "request_extension", seat: mySeat })}>
            <Timer size={13} className="mr-1" /> +30 s
          </Button>
        </div>
      )}
    </div>
  );
}
