"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Bot, Home, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ForumViewProps } from "@/components/forum/Lobby";
import type { RecordEntry } from "@/engine/types";
import { closedReason, fmtClock } from "@/lib/phaseText";
import { ActionPanel } from "./ActionPanel";
import { AiRationale } from "./AiRationale";
import { DocumentsPanel } from "./DocumentsPanel";
import { AiSpeechAudio } from "./AiSpeechAudio";
import { useSpeechRecorder } from "@/hooks/useSpeechRecorder";
import { PhaseBar } from "./PhaseBar";
import { BallotResults, CurrentBallot, FloorMotions, RecordFeed, SeatGrid, SpeakersList } from "./Panels";

const ZoomVideo = dynamic(() => import("@/components/forum/ZoomVideo"), { ssr: false });

/** Engine-driven meeting room. All state comes from the server projection; buttons send engine commands. */
export function Room(props: ForumViewProps & { record: RecordEntry[]; now: () => number }) {
  const { forumId, uid, mySeat, meta, state, actions, record, now } = props;
  const router = useRouter();
  const p = state.phase;
  const me = state.seats[mySeat];
  const isOwner = state.ownerUid === uid;
  const speaker = "seat" in p ? state.seats[(p as { seat: string }).seat] : null;
  const iHoldFloor = p.type === "SPEECH" && p.seat === mySeat && p.speakerKind === "human";
  const canSpeak = iHoldFloor || p.type === "UNMOD_CAUCUS";
  const recorder = useSpeechRecorder(forumId, state, mySeat);

  return (
    <div className="flex min-h-screen flex-col bg-[#f1f5f9]">
      <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-5">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-gray-900">{meta.title}</p>
          <p className="truncate text-[11px] text-gray-500">
            {state.committeeId.replace("_HMUN", "")} · {meta.agenda} · rules {state.rulesetId}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1 text-[11px] font-black uppercase text-gray-700">
            <img src={`https://flagcdn.com/w40/${mySeat}.png`} alt="" className="h-3 w-4 rounded-sm object-cover" /> {me.countryName}
            {isOwner && <span className="text-brand">· room owner</span>}
          </span>
          <Button variant="outline" size="sm" onClick={() => router.push("/")}>
            <Home size={14} className="mr-1" /> Home
          </Button>
        </div>
      </header>
      <PhaseBar state={state} now={now} />

      {p.type === "CLOSED" ? (
        <main className="mx-auto w-full max-w-5xl space-y-4 p-5">
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-widest text-gray-500">Final</p>
            <p className="text-xl font-black text-gray-900">{closedReason(p.reason)}</p>
            <ul className="mt-3 space-y-1 text-sm">
              {Object.values(state.documents).filter((d) => d.kind === "draft_resolution").length === 0 && <li className="text-gray-600">No draft resolution was introduced — no resolution adopted.</li>}
              {Object.values(state.documents)
                .filter((d) => d.kind === "draft_resolution")
                .map((d) => (
                  <li key={d.id}>
                    “{d.title}” v{d.version}: <b>{d.status === "not_voted" ? "not voted (no quorum)" : d.status}</b>
                  </li>
                ))}
            </ul>
          </div>
          <DocumentsPanel state={state} mySeat={mySeat} actions={actions} />
          <BallotResults state={state} />
          <RecordFeed state={state} record={record} />
        </main>
      ) : (
        <main className="grid flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[420px_1fr]">
          <div className="space-y-4">
            <div className="overflow-hidden rounded-3xl bg-[#020617]">
              <div className="flex items-center gap-2 px-4 py-2 text-white">
                {speaker ? (
                  <>
                    <img src={`https://flagcdn.com/w40/${speaker.id}.png`} alt="" className="h-4 w-6 rounded-sm object-cover" />
                    <span className="text-sm font-black">{speaker.countryName}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${speaker.kind === "ai" ? "bg-purple-600" : "bg-brand"}`}>{speaker.kind === "ai" ? "AI" : "Human"}</span>
                    {p.type === "SPEECH" && <span className="ml-auto font-mono text-sm">{fmtClock(p.deadlineMs - now())}</span>}
                  </>
                ) : (
                  <span className="text-xs text-gray-400">No speaker right now</span>
                )}
              </div>
              {p.type === "SPEECH" && p.speakerKind === "ai" && p.ai ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 px-6 py-6 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-purple-600/30">
                    <Bot size={30} className="text-purple-200" />
                  </div>
                  <p className="text-sm text-purple-100">{p.ai.text}</p>
                </div>
              ) : null}
              {p.type === "SPEECH" && p.speakerKind === "ai" ? (
                <AiSpeechAudio forumId={forumId} state={state} now={now} />
              ) : (
                <div className="relative h-[260px]">
                  <ZoomVideo
                    forumId={forumId}
                    onLeave={() => router.push("/")}
                    onConfirmLeave={async () => true}
                    videoSdkRole={isOwner ? 1 : 0}
                    canSpeak={canSpeak}
                    speakerName={speaker?.countryName}
                    micMuted={!canSpeak}
                    onMicMutedChange={() => {}}
                  />
                </div>
              )}
            </div>
            <ActionPanel state={state} mySeat={mySeat} actions={actions} recorder={recorder} />
            {isOwner && (
              <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <p className="mb-2 text-[11px] font-black uppercase tracking-[0.2em] text-gray-800">Room owner controls</p>
                <p className="mb-2 text-xs text-gray-500">
                  App pause (not a formal suspension): max {Math.round(state.settings.limits.pauseMaxSec / 60)} min each, {Math.max(0, Math.round((state.settings.limits.pauseTotalMaxSec - state.usage.pauseUsedSec) / 60))} min left in total.
                </p>
                {state.paused ? (
                  <Button size="sm" onClick={() => void actions.send({ type: "app_resume" })}>
                    <Play size={14} className="mr-1" /> Resume
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => void actions.send({ type: "app_pause" })}>
                    <Pause size={14} className="mr-1" /> Pause app
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="space-y-4">
            <CurrentBallot state={state} />
            <FloorMotions state={state} />
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <SpeakersList state={state} />
              <SeatGrid state={state} mySeat={mySeat} />
            </div>
            <DocumentsPanel state={state} mySeat={mySeat} actions={actions} />
            <BallotResults state={state} />
            <AiRationale forumId={forumId} state={state} positionSetVersion={meta.positionSetVersion} />
            <RecordFeed state={state} record={record} />
          </div>
        </main>
      )}
    </div>
  );
}
