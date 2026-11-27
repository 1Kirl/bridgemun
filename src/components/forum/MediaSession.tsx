"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, createElement } from "react";
import { Camera, CameraOff, Loader2, Mic, MicOff, RefreshCw } from "lucide-react";
import type { PublicForumState } from "@/engine/publicView";
import { authedFetch } from "@/lib/authedFetch";

/* eslint-disable @typescript-eslint/no-explicit-any -- the Zoom SDK client/stream types are loose (dynamic import) */

/** VideoQuality.Video_720P (the SDK is only imported in the browser, inside effects). */
const VIDEO_720P = 3;

type ZParticipant = { userId: number; displayName: string; bVideoOn: boolean; muted: boolean; userIdentity?: string };
type Status = "connecting" | "joined" | "reconnecting" | "error" | "not_configured";

export type MediaHandle = {
  /** Must be called from a user gesture: joins Zoom audio (listening; mic muted). */
  enableAudio: () => Promise<void>;
};

type Props = {
  forumId: string;
  uid: string;
  state: PublicForumState;
  mySeat: string;
  /** true while I hold the floor and chose the microphone: the Zoom mic is unmuted only then. */
  micWanted: boolean;
  onAudioState?: (s: { joined: boolean; micBlocked: boolean }) => void;
};

/**
 * One Zoom Video SDK session per forum (session name, role and token come from the server after a membership check;
 * the SDK secret never reaches the browser). Mounted once in the room and kept mounted across steps, so changing the
 * phase or opening/closing panels never reconnects. Participants are matched to seats by Zoom user_identity = app uid.
 * The tile shows the CURRENT SPEAKER: their camera if on, otherwise their flag and name.
 */
export const MediaSession = forwardRef<MediaHandle, Props>(function MediaSession({ forumId, uid, state, mySeat, micWanted, onAudioState }, ref) {
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [people, setPeople] = useState<ZParticipant[]>([]);
  const [myUserId, setMyUserId] = useState<number | null>(null);
  const [audioJoined, setAudioJoined] = useState(false);
  const [micBlocked, setMicBlocked] = useState(false);
  const [micOpen, setMicOpen] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState("");
  const client = useRef<any>(null);
  const stream = useRef<any>(null);
  const slot = useRef<HTMLDivElement | null>(null);
  const attachedFor = useRef<number | null>(null);

  // ── connect once per forum/user (or on explicit retry) ──
  useEffect(() => {
    let alive = true;
    (async () => {
      setStatus("connecting");
      setError("");
      try {
        const res = await authedFetch("/api/zoom/token", { method: "POST", body: JSON.stringify({ forumId }) });
        if (res.status === 503) {
          if (alive) setStatus("not_configured");
          return;
        }
        if (!res.ok) throw new Error(res.status === 403 ? "Only delegates of this forum can join its media session." : `Could not get a media token (${res.status}).`);
        const { token, sessionName } = (await res.json()) as { token: string; sessionName: string };
        const ZoomVideo = (await import("@zoom/videosdk")).default;
        const c = ZoomVideo.createClient();
        client.current = c;
        await c.init("en-US", "Global", { patchJsMedia: true, leaveOnPageUnload: true });
        const country = state.seats[mySeat]?.countryName ?? "Delegate";
        await c.join(sessionName, token, country);
        if (!alive) return;
        stream.current = c.getMediaStream();
        const me = c.getCurrentUserInfo();
        setMyUserId(me.userId);
        const read = () =>
          (c.getAllUser() as any[]).map((u) => ({ userId: u.userId, displayName: u.displayName, bVideoOn: !!u.bVideoOn, muted: u.muted !== false, userIdentity: u.userIdentity }));
        setPeople(read());
        const refresh = () => alive && setPeople(read());
        c.on("user-added", refresh);
        c.on("user-removed", refresh);
        c.on("user-updated", refresh);
        c.on("peer-video-state-change", refresh);
        c.on("connection-change", (p: any) => {
          if (!alive) return;
          if (p.state === "Reconnecting") setStatus("reconnecting");
          else if (p.state === "Connected") setStatus("joined");
          else if (p.state === "Closed") {
            setStatus("error");
            setError("The media session was closed. Use Reconnect to join again.");
          }
        });
        setStatus("joined");
      } catch (e) {
        if (!alive) return;
        setStatus("error");
        setError((e as Error)?.message || "Media connection failed.");
      }
    })();
    return () => {
      alive = false;
      const c = client.current;
      const s = stream.current;
      client.current = null;
      stream.current = null;
      attachedFor.current = null;
      setAudioJoined(false);
      setCamOn(false);
      void (async () => {
        try {
          await s?.stopVideo?.();
        } catch {}
        try {
          await s?.stopAudio?.();
        } catch {}
        try {
          await c?.leave?.();
        } catch {}
        try {
          (await import("@zoom/videosdk")).default.destroyClient();
        } catch {}
      })();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconnect only for a new forum/user or an explicit retry
  }, [forumId, uid, attempt]);

  // ── audio: one gesture joins listening; mic stays muted unless I am speaking with the microphone ──
  const enableAudio = useCallback(async () => {
    const s = stream.current;
    if (!s || audioJoined) return;
    try {
      await s.startAudio({ mute: true });
      setAudioJoined(true);
      setMicBlocked(false);
    } catch {
      // microphone refused / missing: still let them hear the others
      try {
        await s.startAudio({ speakerOnly: true });
        setAudioJoined(true);
        setMicBlocked(true);
      } catch {
        setMicBlocked(true);
      }
    }
  }, [audioJoined]);
  useImperativeHandle(ref, () => ({ enableAudio }), [enableAudio]);
  useEffect(() => onAudioState?.({ joined: audioJoined, micBlocked }), [audioJoined, micBlocked, onAudioState]);

  useEffect(() => {
    const s = stream.current;
    if (!s || !audioJoined || micBlocked) return;
    (async () => {
      try {
        if (micWanted && !micOpen) {
          await s.unmuteAudio();
          setMicOpen(true);
        } else if (!micWanted && micOpen) {
          await s.muteAudio();
          setMicOpen(false);
        }
      } catch {
        /* state shown by the controls */
      }
    })();
  }, [micWanted, audioJoined, micBlocked, micOpen]);

  const toggleMic = async () => {
    const s = stream.current;
    if (!s || !audioJoined || micBlocked) return;
    try {
      if (micOpen) await s.muteAudio();
      else await s.unmuteAudio();
      setMicOpen(!micOpen);
    } catch {}
  };

  const toggleCam = async () => {
    const s = stream.current;
    if (!s) return;
    setCamError("");
    try {
      if (camOn) {
        await s.stopVideo();
        setCamOn(false);
      } else {
        await s.startVideo();
        setCamOn(true);
      }
    } catch (e) {
      setCamOn(false);
      const msg = String((e as any)?.reason ?? (e as any)?.type ?? e);
      setCamError(/permission|denied|NotAllowed/i.test(msg) ? "Camera blocked by the browser." : /device|NotFound/i.test(msg) ? "No camera found." : "Camera could not start.");
    }
  };

  // ── who is speaking → which Zoom participant ──
  const p = state.phase;
  const speakerSeat = p.type === "SPEECH" || p.type === "SPEECH_PREP" || p.type === "SPEECH_CONFIRM" || p.type === "AI_SPEECH_PENDING" ? state.seats[p.seat] : null;
  const speakerUid = speakerSeat?.kind === "human" ? speakerSeat.uid : undefined;
  // de-duplicate rejoins: the latest userId per identity wins
  const byIdentity = new Map<string, ZParticipant>();
  for (const x of people) if (x.userIdentity) byIdentity.set(x.userIdentity, x);
  const speakerP = speakerUid ? byIdentity.get(speakerUid) : undefined;
  const speakerIsMe = !!speakerUid && speakerUid === uid;
  const showVideoOf = speakerIsMe ? (camOn ? myUserId : null) : speakerP?.bVideoOn ? speakerP.userId : null;

  useEffect(() => {
    const s = stream.current;
    const el = slot.current;
    if (!s || !el) return;
    (async () => {
      if (attachedFor.current !== null && attachedFor.current !== showVideoOf) {
        try {
          await s.detachVideo(attachedFor.current);
        } catch {}
        el.replaceChildren();
        attachedFor.current = null;
      }
      if (showVideoOf !== null && attachedFor.current !== showVideoOf) {
        try {
          const node = await s.attachVideo(showVideoOf, VIDEO_720P);
          if (node instanceof HTMLElement) {
            el.replaceChildren(node);
            attachedFor.current = showVideoOf;
          }
        } catch {}
      }
    })();
  }, [showVideoOf, status]);

  const connected = status === "joined" || status === "reconnecting";
  return (
    <div className="flex h-full flex-col" data-testid="media-session" data-status={status}>
      <div className="relative min-h-0 flex-1">
        {createElement("video-player-container", { className: `absolute inset-0 block ${showVideoOf !== null ? "" : "invisible"}` }, <div ref={slot} className="h-full w-full" />)}
        {showVideoOf === null && speakerSeat && speakerSeat.kind === "human" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-300">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`https://flagcdn.com/w160/${speakerSeat.id}.png`} alt="" className="h-14 w-20 rounded object-cover ring-1 ring-white/10" />
            <p className="text-xs">{speakerIsMe ? "Your camera is off" : speakerP ? "Camera off" : connected ? "Not connected to video" : ""}</p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-3 py-2 text-[11px] text-gray-300" data-testid="media-controls">
        {status === "connecting" && (
          <span className="flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" /> Connecting video…
          </span>
        )}
        {status === "reconnecting" && <span className="text-amber-300">Reconnecting video…</span>}
        {status === "not_configured" && <span>Video is not configured on this server.</span>}
        {status === "error" && (
          <>
            <span className="text-red-300">{error}</span>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 font-bold text-white">
              <RefreshCw size={11} /> Reconnect
            </button>
          </>
        )}
        {connected && (
          <>
            <span className="flex items-center gap-1" data-testid="mic-state">
              {micBlocked ? <MicOff size={12} className="text-red-300" /> : micOpen ? <Mic size={12} className="text-emerald-300" /> : <MicOff size={12} />}
              {!audioJoined ? "Audio off" : micBlocked ? "Listening only (microphone blocked)" : micOpen ? "Your mic is live" : "Mic muted (opens when you speak)"}
            </span>
            {audioJoined && !micBlocked && micWanted && (
              <button type="button" onClick={() => void toggleMic()} className="rounded bg-white/10 px-2 py-0.5 font-bold text-white">
                {micOpen ? "Mute" : "Unmute"}
              </button>
            )}
            <button type="button" onClick={() => void toggleCam()} className="ml-auto flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 font-bold text-white" data-testid="camera-toggle">
              {camOn ? <Camera size={12} /> : <CameraOff size={12} />} {camOn ? "Camera on" : "Camera off"}
            </button>
            {camError && <span className="w-full text-amber-300">{camError} You can keep speaking with audio or text.</span>}
          </>
        )}
      </div>
    </div>
  );
});
