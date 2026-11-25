'use client';

import { useEffect, useRef, useState, useCallback, createElement } from 'react';
import { VideoQuality } from '@zoom/videosdk';
import { Mic, MicOff, Video, VideoOff, Home, Loader2, Lock, Volume2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

type Participant = {
  userId: number;
  displayName: string;
  bVideoOn: boolean;
  muted: boolean;
  /** JWT의 userIdentity(=앱 uid). 모더레이터 식별에 사용 */
  userIdentity?: string;
};

type Props = {
  forumId: string;
  onLeave?: () => void;
  /** true일 때에만 leave 진행 (홈으로 이동 의도에 맞춰 이탈 확인) */
  onConfirmLeave?: () => Promise<boolean>;
  /** Zoom Video SDK JWT: 0 참여자, 1 호스트(모더레이터 미디어 송출에 필요할 수 있음) */
  videoSdkRole?: 0 | 1;
  canSpeak?: boolean;
  speakerName?: string; // 현재 발언 중인 사람의 displayName
  /** 모더레이터(의장) 식별: 앱 uid. 참가자 화면에 의장 타일을 상시 표시 (F2-02) */
  moderatorIdentity?: string;
  /** uid 매칭 실패 시 폴백용 모더레이터 displayName */
  moderatorName?: string;
  micMuted: boolean;
  onMicMutedChange: (muted: boolean) => void;
};

/**
 * Zoom Web Video SDK: remote video must use attachVideo + VideoPlayer inside video-player-container.
 * renderVideo(canvas, …) is deprecated and can throw STREAM_MISMATCH_RENDER_ELEMENT (6003) on WebRTC.
 */
function RemoteVideoAttachment({
  userId,
  register,
  compact,
}: {
  userId: number;
  register: (userId: number, el: HTMLDivElement | null) => void;
  /** Hidden off-screen slots keep a stable decode path without layout */
  compact?: boolean;
}) {
  return createElement(
    'video-player-container',
    {
      className: compact
        ? 'block h-[180px] w-[320px] max-w-none'
        : 'block h-full w-full min-h-0',
    },
    <div
      ref={(el) => register(userId, el)}
      className="min-h-0 h-full w-full bg-black"
    />,
  );
}

export default function ZoomVideo({
  forumId,
  onLeave,
  onConfirmLeave,
  videoSdkRole = 0,
  canSpeak = false,
  speakerName,
  moderatorIdentity,
  moderatorName,
  micMuted,
  onMicMutedChange,
}: Props) {
  const { user } = useAuth();

  const [status, setStatus] = useState<'connecting' | 'joined' | 'error'>('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const [videoOn, setVideoOn] = useState(false);
  const [audioJoined, setAudioJoined] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);

  const clientRef = useRef<any>(null);
  const streamRef = useRef<any>(null);
  const selfVideoRef = useRef<HTMLVideoElement>(null);
  const remoteSlotRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const participantsRef = useRef<Participant[]>([]);
  participantsRef.current = participants;

  const syncRemoteVideoForUser = useCallback(async (userId: number) => {
    const stream = streamRef.current;
    const slot = remoteSlotRefs.current.get(userId);
    const p = participantsRef.current.find((x) => x.userId === userId);
    if (!stream || !slot) return;

    try {
      if (p?.bVideoOn) {
        await stream.detachVideo(userId).catch(() => {});
        slot.replaceChildren();
        const node = await stream.attachVideo(userId, VideoQuality.Video_720P);
        if (node instanceof HTMLElement) {
          slot.appendChild(node);
        } else {
          console.error('Zoom attachVideo failed:', node);
        }
      } else {
        await stream.detachVideo(userId).catch(() => {});
        slot.replaceChildren();
      }
    } catch (e) {
      console.error('Zoom remote video sync:', e);
    }
  }, []);

  const syncRemoteVideoRef = useRef(syncRemoteVideoForUser);
  syncRemoteVideoRef.current = syncRemoteVideoForUser;

  const cleanup = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      await client.leave();
    } catch {}
    try {
      const ZoomVideo = (await import('@zoom/videosdk')).default;
      ZoomVideo.destroyClient();
    } catch {}
    clientRef.current = null;
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!user || !forumId) return;
    let mounted = true;

    const connect = async () => {
      try {
        // 1. 서버에서 JWT 발급
        const res = await fetch('/api/zoom/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionName: forumId,
            role: videoSdkRole,
            userIdentity: user.uid,
          }),
        });
        if (!res.ok) throw new Error('Failed to get session token');
        const { token } = await res.json();

        // 2. SDK 동적 로드 (브라우저 전용)
        const ZoomVideo = (await import('@zoom/videosdk')).default;
        const client = ZoomVideo.createClient();
        clientRef.current = client;

        // 3. SDK 초기화 (CDN에서 WASM 로드)
        await client.init('en-US', 'Global', { patchJsMedia: true });

        // 4. 세션 입장
        const displayName = user.displayName || user.email || 'Anonymous';
        await client.join(forumId, token, displayName);

        if (!mounted) return;

        const stream = client.getMediaStream();
        streamRef.current = stream;
        setStatus('joined');

        // 5. 현재 참여자 목록
        const me = client.getCurrentUserInfo();
        const allUsers: any[] = client.getAllUser();
        setParticipants(
          allUsers
            .filter((u: any) => u.userId !== me.userId)
            .map((u: any) => ({
              userId: u.userId,
              displayName: u.displayName,
              bVideoOn: !!u.bVideoOn,
              muted: u.muted !== false,
              userIdentity: u.userIdentity,
            }))
        );

        // 6. 이벤트: 참여자 입장
        client.on('user-added', (payload: any[]) => {
          setParticipants((prev) => [
            ...prev,
            ...payload.map((u) => ({
              userId: u.userId,
              displayName: u.displayName,
              bVideoOn: false,
              muted: true,
              userIdentity: u.userIdentity,
            })),
          ]);
        });

        // 7. 이벤트: 참여자 퇴장
        client.on('user-removed', (payload: any[]) => {
          setParticipants((prev) =>
            prev.filter((p) => !payload.find((u) => u.userId === p.userId))
          );
        });

        // 8. 이벤트: 참여자 상태 변경 (비디오 on/off, 마이크 on/off)
        client.on('user-updated', (payload: any[]) => {
          setParticipants((prev) =>
            prev.map((p) => {
              const u = payload.find((x) => x.userId === p.userId);
              if (!u) return p;
              return { ...p, ...u };
            }),
          );
          requestAnimationFrame(() => {
            for (const u of payload) {
              if (u.bVideoOn !== undefined) {
                void syncRemoteVideoRef.current(u.userId);
              }
            }
          });
        });
      } catch (err: any) {
        if (!mounted) return;
        setErrorMsg(err.message || 'Connection failed');
        setStatus('error');
      }
    };

    void connect().catch(() => {});
    return () => {
      mounted = false;
      void cleanup().catch(() => {});
    };
  }, [user, forumId, cleanup, videoSdkRole]);

  // canSpeak이 false가 되면 강제로 마이크/비디오 중지
  useEffect(() => {
    if (!streamRef.current || status !== 'joined') return;
    if (!canSpeak) {
      if (!micMuted && audioJoined) {
        streamRef.current.muteAudio().catch(() => {});
        onMicMutedChange(true);
      }
      if (videoOn) {
        streamRef.current.stopVideo().catch(() => {});
        setVideoOn(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSpeak]);

  const registerRemoteSlot = useCallback(
    (userId: number, el: HTMLDivElement | null) => {
      if (el) {
        remoteSlotRefs.current.set(userId, el);
        void syncRemoteVideoForUser(userId);
      } else {
        remoteSlotRefs.current.delete(userId);
        const stream = streamRef.current;
        if (stream) {
          void stream.detachVideo(userId).catch(() => {});
        }
      }
    },
    [syncRemoteVideoForUser],
  );

  // 발언권과 무관하게 누구나 원격 오디오를 들으려면 startAudio()가 필요하다.
  // (Zoom Video SDK는 startAudio 호출 전에는 남의 소리도 들리지 않음 — F2-02 원인①)
  // autoplay 정책상 사용자 클릭 제스처가 필요하므로 별도 버튼으로 분리한다.
  const joinAudio = async () => {
    const stream = streamRef.current;
    if (!stream || audioJoined) return;
    try {
      await stream.startAudio();
      setAudioJoined(true);
      // 청취자는 송출하지 않도록 기본 음소거. 발언권이 있으면 마이크 버튼으로 해제.
      await stream.muteAudio();
      onMicMutedChange(true);
    } catch {
      // 제스처/장치 거부 시 사용자가 다시 시도할 수 있도록 조용히 무시
    }
  };

  const toggleAudio = async () => {
    const stream = streamRef.current;
    if (!stream) return;
    try {
      if (!audioJoined) {
        await stream.startAudio();
        setAudioJoined(true);
        onMicMutedChange(false);
      } else if (micMuted) {
        await stream.unmuteAudio();
        onMicMutedChange(false);
      } else {
        await stream.muteAudio();
        onMicMutedChange(true);
      }
    } catch {
      // SDK rejects are user-facing via controls; avoid unhandled rejection
    }
  };

  const toggleVideo = async () => {
    const stream = streamRef.current;
    if (!stream) return;
    try {
      if (videoOn) {
        await stream.stopVideo();
        setVideoOn(false);
      } else {
        await stream.startVideo({ videoElement: selfVideoRef.current ?? undefined });
        setVideoOn(true);
      }
    } catch {
      // same as toggleAudio
    }
  };

  const handleLeave = async () => {
    if (onConfirmLeave) {
      try {
        const ok = await onConfirmLeave();
        if (!ok) return;
      } catch {
        return;
      }
    }
    try {
      await cleanup();
    } catch {
      // leave cleanup best-effort
    }
    onLeave?.();
  };

  // ── UI ────────────────────────────────────────────────────────────

  if (status === 'connecting') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-white/50">
        <Loader2 size={28} className="animate-spin" />
        <p className="text-xs font-semibold">Connecting to session…</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-white/60">
        <p className="text-xs text-center font-semibold text-red-400">{errorMsg}</p>
        <button
          onClick={() => { setStatus('connecting'); setErrorMsg(''); }}
          className="mt-2 rounded-md bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/20"
        >
          Retry
        </button>
      </div>
    );
  }

  // 발언자 타일만 결정
  const selfTile = (
    <div key="self" className="relative overflow-hidden rounded-2xl bg-black/50 min-h-0">
      <video
        ref={selfVideoRef}
        autoPlay
        muted
        playsInline
        className={`h-full w-full object-cover ${!videoOn ? 'hidden' : ''}`}
      />
      {!videoOn && (
        <div className="flex h-full items-center justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-white/70 text-2xl font-black">
            {(user?.displayName || user?.email || 'ME').charAt(0).toUpperCase()}
          </div>
        </div>
      )}
      <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white/90">
        {user?.displayName || user?.email || 'You'} (Speaking)
      </span>
      {micMuted ? (
        <MicOff size={12} className="absolute left-2 top-2 text-red-400 drop-shadow-md" aria-label="Muted" />
      ) : null}
    </div>
  );

  const speakerParticipant = speakerName
    ? participants.find((p) => p.displayName === speakerName)
    : null;

  const speakerTile = speakerParticipant ? (
    <div key={speakerParticipant.userId} className="relative flex min-h-0 flex-col overflow-hidden rounded-2xl bg-black/50">
      {speakerParticipant.bVideoOn ? (
        <RemoteVideoAttachment
          userId={speakerParticipant.userId}
          register={registerRemoteSlot}
        />
      ) : (
        <div className="flex h-full min-h-[120px] items-center justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-2xl font-black text-white/70">
            {speakerParticipant.displayName.charAt(0).toUpperCase()}
          </div>
        </div>
      )}
      <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white/90">
        {speakerParticipant.displayName} (Speaking)
      </span>
      {speakerParticipant.muted ? (
        <MicOff size={12} className="absolute left-2 top-2 text-red-400 drop-shadow-md" aria-label="Muted" />
      ) : null}
    </div>
  ) : null;

  // 현재 내가 발언권을 승인받은 사람인지 확인
  const isMeApproved = canSpeak && speakerName && (user?.displayName === speakerName || user?.email === speakerName);
  
  // 내가 방장이거나 발언 승인을 받았는데, 다른 사람(참여자)이 현재 발언자로 설정되어 있는지 확인
  const isOtherApproved = !!speakerName && !isMeApproved;

  // 화면에 표시할 타일 결정: 
  // 1. 다른 사람이 발언 승인을 받았으면 그 사람 화면 표시
  // 2. 내가 발언 승인을 받았거나, 방장인데 아무도 발언 승인을 안 받은 경우 내 화면 표시
  const activeTile = isOtherApproved ? speakerTile : (isMeApproved || (canSpeak && !speakerName) ? selfTile : null);

  // 모더레이터(의장) 상시 타일 — 참가자 화면에 의장 영상/오디오가 항상 보이도록 (F2-02 ②).
  // participants 목록은 본인 제외이므로, 이 항목은 "내가 참가자이고 의장이 원격"일 때만 잡힌다.
  const moderatorParticipant = moderatorIdentity
    ? participants.find((p) => p.userIdentity === moderatorIdentity)
    : moderatorName
      ? participants.find((p) => p.displayName === moderatorName)
      : null;

  // 의장이 현재 발언자(activeTile)와 동일하면 중복 표시하지 않는다.
  const showModeratorTile =
    !!moderatorParticipant &&
    moderatorParticipant.userId !== speakerParticipant?.userId;

  const moderatorTile = showModeratorTile ? (
    <div
      key={`mod-${moderatorParticipant!.userId}`}
      className="relative flex min-h-0 flex-col overflow-hidden rounded-2xl bg-black/50 ring-1 ring-amber-400/30"
    >
      {moderatorParticipant!.bVideoOn ? (
        <RemoteVideoAttachment
          userId={moderatorParticipant!.userId}
          register={registerRemoteSlot}
        />
      ) : (
        <div className="flex h-full min-h-[120px] items-center justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-2xl font-black text-white/70">
            {moderatorParticipant!.displayName.charAt(0).toUpperCase()}
          </div>
        </div>
      )}
      <span className="absolute bottom-2 left-2 rounded-md bg-amber-500/85 px-2 py-0.5 text-[10px] font-bold text-white">
        {moderatorParticipant!.displayName} (Chair)
      </span>
      {moderatorParticipant!.muted ? (
        <MicOff size={12} className="absolute left-2 top-2 text-red-400 drop-shadow-md" aria-label="Muted" />
      ) : null}
    </div>
  ) : null;

  const tiles = [moderatorTile, activeTile].filter(Boolean);

  const hiddenRemoteSlots = participants
    .filter((p) => p !== speakerParticipant && p !== moderatorParticipant)
    .map((p) => (
      <div key={p.userId} className="hidden" aria-hidden>
        <RemoteVideoAttachment userId={p.userId} register={registerRemoteSlot} compact />
      </div>
    ));

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="hidden">{hiddenRemoteSlots}</div>

      {/* 영상 화면 — 의장(상시) + 현재 발언자 */}
      <div
        className={`flex-1 p-2 min-h-0 grid grid-rows-1 gap-2 ${
          tiles.length > 1 ? 'grid-cols-2' : 'grid-cols-1'
        }`}
      >
        {tiles.length > 0 ? (
          tiles
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-white/30 rounded-2xl bg-black/20">
            <div className="text-4xl">🎤</div>
            <p className="text-sm font-semibold">No active speaker</p>
          </div>
        )}
      </div>

      {/* 컨트롤 바 */}
      <div className="flex shrink-0 items-center justify-center gap-3 pb-2">
        {/* 오디오 참여(듣기) — 발언권과 무관하게 모두가 소리를 들으려면 필요 */}
        {!audioJoined && (
          <button
            type="button"
            onClick={() => void joinAudio()}
            title="Join audio to hear the session"
            className="flex h-9 items-center gap-1.5 rounded-full bg-brand px-3 text-xs font-bold text-white transition-colors hover:bg-brand/90"
          >
            <Volume2 size={15} />
            Join audio
          </button>
        )}

        {/* 마이크 — canSpeak=false면 잠금 */}
        <button
          onClick={canSpeak ? () => void toggleAudio() : undefined}
          title={!canSpeak ? 'Waiting for approval' : !audioJoined ? 'Join Audio' : micMuted ? 'Unmute' : 'Mute'}
          className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
            !canSpeak
              ? 'bg-white/5 text-white/20 cursor-not-allowed'
              : audioJoined && !micMuted
              ? 'bg-white/20 text-white hover:bg-white/30'
              : 'bg-red-500/80 text-white hover:bg-red-500'
          }`}
        >
          {!canSpeak ? <Lock size={13} /> : audioJoined && !micMuted ? <Mic size={15} /> : <MicOff size={15} />}
        </button>

        {/* 비디오 — canSpeak=false면 잠금 */}
        <button
          onClick={canSpeak ? () => void toggleVideo() : undefined}
          title={!canSpeak ? 'Waiting for approval' : videoOn ? 'Stop Video' : 'Start Video'}
          className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
            !canSpeak
              ? 'bg-white/5 text-white/20 cursor-not-allowed'
              : videoOn
              ? 'bg-white/20 text-white hover:bg-white/30'
              : 'bg-red-500/80 text-white hover:bg-red-500'
          }`}
        >
          {!canSpeak ? <Lock size={13} /> : videoOn ? <Video size={15} /> : <VideoOff size={15} />}
        </button>

        <button
          type="button"
          onClick={() => void handleLeave()}
          title="Return to main page"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors"
        >
          <Home size={15} strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}
