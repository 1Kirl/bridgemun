"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogoSymbol } from "@/components/brand/Logo";
import { useCallback, useEffect, useRef, useState } from "react";
import { MediaSession, type MediaHandle } from "@/components/forum/MediaSession";
import { FilePlus2 } from "lucide-react";
import type { PublicForumState } from "@/engine/publicView";
import { DraftEditor, useDocDraft, type DocDraft } from "./DraftEditor";
import { useSpeechPrep } from "@/hooks/useSpeechPrep";
import { SpeechFocus } from "./SpeechFocus";
import { SpeechModal } from "./SpeechModal";
import { SpeechPrepCard } from "./SpeechPrepCard";
import { Clock, Home, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ForumViewProps } from "@/components/forum/Lobby";
import type { RecordEntry } from "@/engine/types";
import { closedReason, fmtClock } from "@/lib/phaseText";
import { publicResponseView, sessionEndOf } from "@/lib/meetingFlow";
import { Briefing } from "./Briefing";
import { ResponseTracker, StageTrack, VoteChart } from "./Visuals";
import { ChairPanel, SpeakerPanel } from "./Stage";
import { RecordLog } from "./RecordLog";
import { ActionPanel } from "./ActionPanel";
import { AiRationale } from "./AiRationale";
import { DocumentsPanel } from "./DocumentsPanel";
import { AiSpeechAudio } from "./AiSpeechAudio";
import { useSpeechRecorder } from "@/hooks/useSpeechRecorder";
import { BallotResults, FloorMotions, RecordFeed, SeatGrid, SpeakersList } from "./Panels";


/** Engine-driven meeting room. All state comes from the server projection; buttons send engine commands. */
export function Room(props: ForumViewProps & { record: RecordEntry[]; now: () => number }) {
  const { forumId, uid, mySeat, meta, state, actions, record, now } = props;
  const router = useRouter();
  const p = state.phase;
  const me = state.seats[mySeat];
  const isOwner = state.ownerUid === uid;
  const iHoldFloor = p.type === "SPEECH" && p.seat === mySeat && p.speakerKind === "human";
  const prep = useSpeechPrep(forumId, mySeat);
  const recorder = useSpeechRecorder(forumId, state, mySeat, prep.mode === "mic");
  // Own turn (recognised or speaking): a dialog over the room. The room stays mounted and visible behind it.
  const focus = (p.type === "SPEECH_PREP" && p.seat === mySeat) || iHoldFloor;
  const [speechHidden, setSpeechHidden] = useState(false);
  const hideSpeech = useCallback(() => setSpeechHidden(true), []);
  // a new turn always opens the dialog again; preparing → speaking keeps the delegate's choice
  const [prevFocus, setPrevFocus] = useState(focus);
  if (prevFocus !== focus) {
    setPrevFocus(focus);
    if (!focus) setSpeechHidden(false);
  }
  // One gesture turns on meeting audio: Zoom listening + AI voice playback (browsers block autoplay until then).
  const media = useRef<MediaHandle>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [zoomAudio, setZoomAudio] = useState({ joined: false, micBlocked: false });
  const onZoomAudio = useCallback((s: { joined: boolean; micBlocked: boolean }) => setZoomAudio(s), []);
  const turnOnAudio = async () => {
    setAudioUnlocked(true);
    setAudioBlocked(false);
    await media.current?.enableAudio();
  };
  const doc = useDocDraft(forumId, mySeat);
  // The landing's "Reduce motion" choice also quiets the meeting screens (the OS setting is handled in CSS).
  useEffect(() => {
    try {
      if (localStorage.getItem("bridgemun.motion") === "off") document.documentElement.dataset.bmMotion = "off";
      else delete document.documentElement.dataset.bmMotion;
    } catch {}
  }, []);
  // A text speech whose reply was lost still entered the record: never offer the same draft again.
  const lastMine = [...record].reverse().find((r) => r.seat === mySeat && r.source === "human_text");
  useEffect(() => {
    if (lastMine && prep.draft.trim() && lastMine.text === prep.draft.trim()) prep.clearDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMine?.seq]);
  const upcoming = !focus && p.type !== "CLOSED" && (state.speakersList.includes(mySeat) || (p.type === "MOD_CAUCUS" && p.volunteers.includes(mySeat)));
  const t = now();
  const rv = publicResponseView(state);
  const sessionLeft = state.settings.sessionEndsAtMs && p.type !== "CLOSED" && p.type !== "BRIEFING" ? sessionEndOf(state, t) - t : null;

  return (
    <div className="bm-room flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between gap-3 border-b border-[var(--bm-line)] bg-white/90 px-5 backdrop-blur">
        <Link href="/" aria-label="BridgeMUN home" className="shrink-0" title="BridgeMUN home">
          <LogoSymbol className="h-8 w-8" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="bm-heading truncate text-sm font-black text-gray-900">{meta.title}</p>
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
        <>
        <SpeechModal active={focus} hidden={speechHidden} onHide={hideSpeech}>
          <SpeechFocus state={state} mySeat={mySeat} actions={actions} recorder={recorder} prep={prep} now={t} />
        </SpeechModal>
        {focus && speechHidden && (
          <div className="sticky top-0 z-40 flex flex-wrap items-center gap-2 border-b border-red-200 bg-red-50 px-5 py-2 text-sm font-bold text-red-800" role="status" data-testid="speech-reopen-bar">
            <span className="h-2.5 w-2.5 rounded-full bg-red-600 motion-safe:animate-pulse" aria-hidden />
            {iHoldFloor ? "You have the floor — your speech is still running." : "It is your turn to speak."}
            <Button size="sm" className="ml-auto" onClick={() => setSpeechHidden(false)} data-testid="reopen-speech">
              Open speech screen
            </Button>
          </div>
        )}
        <main className="grid flex-1 grid-cols-1 gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* CENTRE: chair | speaker → Record → my actions. Fixed order and sizes; content changes inside. */}
          <div className="min-w-0 space-y-4" data-testid="room-center">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="stage-row">
              <ChairPanel state={state} rv={rv} now={t} />
              <SpeakerPanel
                state={state}
                now={t}
                aiAudio={<AiSpeechAudio forumId={forumId} state={state} now={now} unlocked={audioUnlocked} onBlocked={() => setAudioBlocked(true)} />}
                audioButton={
                  !audioUnlocked || audioBlocked || !zoomAudio.joined ? (
                    <button type="button" onClick={() => void turnOnAudio()} className="ml-auto shrink-0 rounded-full bg-brand px-3 py-1 text-[11px] font-black text-white shadow" data-testid="turn-on-audio">
                      Turn on audio
                    </button>
                  ) : (
                    <span className="ml-auto shrink-0 text-[10px] font-bold text-emerald-300" data-testid="audio-on">
                      Audio on
                    </span>
                  )
                }
                video={<MediaSession ref={media} forumId={forumId} uid={uid} state={state} mySeat={mySeat} micWanted={iHoldFloor && prep.mode === "mic"} onAudioState={onZoomAudio} />}
              />
            </div>
            <RecordLog state={state} record={record} />
            <ActionPanel
              state={state}
              mySeat={mySeat}
              actions={actions}
              recorder={recorder}
              now={t}
              headerAction={<DraftButton state={state} mySeat={mySeat} doc={doc} />}
              mainBottom={<NegotiationDrafting state={state} mySeat={mySeat} doc={doc} />}
              optionalTop={upcoming ? <SpeechPrepCard prep={prep} /> : null}
              optionalBottom={
                isOwner ? (
                  <details className="rounded-xl border border-gray-100 p-3 text-xs">
                    <summary className="cursor-pointer font-bold text-gray-700">Room owner controls</summary>
                    <p className="my-2 text-gray-500">
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
                  </details>
                ) : null
              }
            />
            {doc.draft.open && canWriteDocs(state, mySeat) && <DraftEditor doc={doc} mySeat={mySeat} actions={actions} />}
          </div>
          {/* SIDE: reference information, fixed order */}
          <aside className="min-w-0 space-y-4" data-testid="room-side">
            <FloorMotions state={state} />
            <SeatGrid state={state} mySeat={mySeat} />
            <ResponseTracker state={state} rv={rv} mySeat={mySeat} />
            <BallotResults state={state} />
            <SpeakersList state={state} />
            <DocumentsPanel state={state} mySeat={mySeat} actions={actions} onNewDraft={doc.open} />
            <AiRationale forumId={forumId} state={state} positionSetVersion={meta.positionSetVersion} />
          </aside>
        </main>
        </>
      )}
    </div>
  );
}

/** Final screen: one card per resolution with the deciding vote, plus why the forum ended. */
function FinalResults({ state, reason }: { state: ForumViewProps["state"]; reason: string }) {
  // In the order they were voted (rule 34 order), not the order the documents happen to be stored in.
  const order = state.votingOrder ?? [];
  const pos = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  const resolutions = Object.values(state.documents)
    .filter((d) => d.kind === "draft_resolution" && (d.status === "adopted" || d.status === "failed" || d.status === "not_voted" || d.status === "introduced"))
    .sort((a, b) => pos(a.id) - pos(b.id) || a.submittedAtMs - b.submittedAtMs);
  const finalBallot = (docId: string) =>
    Object.values(state.ballots)
      .filter((b) => b.subject.type === "resolution" && b.subject.docId === docId)
      .sort((a, b) => b.openedAtMs - a.openedAtMs)[0];
  return (
    <section className="bm-card bm-tone-mint rounded-2xl p-5" data-testid="final-results">
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

function canWriteDocs(state: PublicForumState, mySeat: string) {
  const p = state.phase;
  return state.seats[mySeat]?.attendance !== "not_recorded" && !state.debateClosed && p.type !== "CLOSED" && p.type !== "LOBBY" && p.type !== "BRIEFING";
}

/**
 * "New draft" lives in ONE small, fixed place: the header of the action card. It is offered whenever the engine
 * allows writing (present, debate not closed); it never covers a required action. The editor opens full width
 * below the action card. In negotiation a clearer prompt is added inside the main column.
 */
function DraftButton({ state, mySeat, doc }: { state: PublicForumState; mySeat: string; doc: DocDraft }) {
  if (!canWriteDocs(state, mySeat) || doc.draft.open) return null;
  return (
    <Button size="sm" variant="outline" onClick={doc.open} data-testid="center-new-draft">
      <FilePlus2 size={14} className="mr-1" /> {doc.hasContent ? "Continue draft" : "New draft"}
    </Button>
  );
}

function NegotiationDrafting({ state, mySeat, doc }: { state: PublicForumState; mySeat: string; doc: DocDraft }) {
  if (state.phase.type !== "UNMOD_CAUCUS" || !canWriteDocs(state, mySeat) || doc.draft.open) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-dashed border-brand/40 bg-brand-light p-3" data-testid="draft-entry-prominent">
      <div>
        <p className="text-sm font-black text-brand">Negotiation & drafting</p>
        <p className="text-xs text-gray-600">Write a draft resolution or working paper, or sign drafts under Documents.</p>
      </div>
      <Button onClick={doc.open}>
        <FilePlus2 size={16} className="mr-1" /> {doc.hasContent ? "Continue your draft" : "New draft"}
      </Button>
    </div>
  );
}
