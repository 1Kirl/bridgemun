"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Bot, Clock, Home, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ForumViewProps } from "@/components/forum/Lobby";
import type { RecordEntry } from "@/engine/types";
import { closedReason, fmtClock } from "@/lib/phaseText";
import { publicResponseView, sessionEndOf } from "@/lib/meetingFlow";
import { Briefing } from "./Briefing";
import { ResponseTracker, SituationCard, StageTrack, VoteChart } from "./Visuals";
import { ActionPanel } from "./ActionPanel";
import { AiRationale } from "./AiRationale";
import { DocumentsPanel } from "./DocumentsPanel";
import { AiSpeechAudio } from "./AiSpeechAudio";
import { useSpeechRecorder } from "@/hooks/useSpeechRecorder";
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
  const t = now();
  const rv = publicResponseView(state);
  const sessionLeft = state.settings.sessionEndsAtMs && p.type !== "CLOSED" && p.type !== "BRIEFING" ? sessionEndOf(state, t) - t : null;

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
          {sessionLeft !== null && (
            <span className="hidden items-center gap-1 rounded-full bg-gray-100 px-3 py-1 font-mono text-xs font-black text-gray-700 sm:flex" title="Session time left (time spent waiting for human responses is not counted)">
              <Clock size={12} /> {fmtClock(sessionLeft)}
            </span>
          )}
          <span className="flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1 text-[11px] font-black uppercase text-gray-700">
            <img src={`https://flagcdn.com/w40/${mySeat}.png`} alt="" className="h-3 w-4 rounded-sm object-cover" /> {me.countryName}
            {isOwner && <span className="hidden text-brand sm:inline">· room owner</span>}
          </span>
          <Button variant="outline" size="sm" onClick={() => router.push("/")}>
            <Home size={14} className="mr-1" /> Home
          </Button>
        </div>
      </header>
      <StageTrack state={state} />
      <Briefing state={state} now={t} />
      {state.paused && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm font-bold text-amber-900" role="status">
          <Pause size={16} />
          {state.paused.reason === "no_humans"
            ? `On hold: no human delegate is online (app policy H1). Closes in ${fmtClock(state.paused.autoResumeAtMs - t)} unless someone returns.`
            : `App paused by the room owner — resumes automatically in ${fmtClock(state.paused.autoResumeAtMs - t)}.`}
        </div>
      )}

      {p.type === "CLOSED" ? (
        <main className="mx-auto w-full max-w-5xl space-y-4 p-5">
          <FinalResults state={state} reason={closedReason(p.reason)} />
          <BallotResults state={state} all />
          <DocumentsPanel state={state} mySeat={mySeat} actions={actions} />
          <RecordFeed state={state} record={record} />
        </main>
      ) : (
        <main className="grid flex-1 grid-cols-1 gap-4 p-3 sm:p-4 lg:grid-cols-[440px_1fr]">
          <div className="space-y-4">
            <SituationCard state={state} rv={rv} now={t} />
            <ActionPanel state={state} mySeat={mySeat} actions={actions} recorder={recorder} now={t} />
            <ResponseTracker state={state} rv={rv} mySeat={mySeat} />
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

/** Final screen: one card per resolution with the deciding vote, plus why the forum ended. */
function FinalResults({ state, reason }: { state: ForumViewProps["state"]; reason: string }) {
  const resolutions = Object.values(state.documents).filter((d) => d.kind === "draft_resolution" && (d.status === "adopted" || d.status === "failed" || d.status === "not_voted" || d.status === "introduced"));
  const finalBallot = (docId: string) =>
    Object.values(state.ballots)
      .filter((b) => b.subject.type === "resolution" && b.subject.docId === docId)
      .sort((a, b) => b.openedAtMs - a.openedAtMs)[0];
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm" data-testid="final-results">
      <p className="text-[11px] font-black uppercase tracking-widest text-gray-500">Results</p>
      <p className="text-xl font-black text-gray-900">{reason}</p>
      {resolutions.length === 0 ? (
        <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">No draft resolution was introduced — no resolution was adopted.</p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {resolutions.map((d) => {
            const b = finalBallot(d.id);
            const tone = d.status === "adopted" ? "border-emerald-300 bg-emerald-50" : d.status === "failed" ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-slate-50";
            return (
              <div key={d.id} className={`rounded-xl border-2 p-3 ${tone}`}>
                <p className="text-sm font-black text-gray-900">
                  “{d.title}” <span className="font-normal text-gray-500">v{d.version}</span>
                </p>
                <p className="mb-2 text-xs font-black uppercase tracking-wider text-gray-600">
                  {d.status === "adopted" ? "Adopted" : d.status === "failed" ? "Not adopted" : d.status === "not_voted" ? "Not voted — no quorum" : "Not voted"}
                </p>
                {b ? <VoteChart state={state} b={b} /> : <p className="text-xs text-gray-500">{state.divisions?.[d.id]?.outcome === "rejected_as_whole" ? "Every divided part was rejected; rejected as a whole (rule 33)." : "No final vote was held."}</p>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
