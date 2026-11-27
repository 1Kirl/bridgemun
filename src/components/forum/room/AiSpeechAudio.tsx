"use client";

import { useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/authedFetch";
import type { PublicForumState } from "@/engine/publicView";

type Props = {
  forumId: string;
  state: PublicForumState;
  now: () => number;
  /** The user has clicked "Turn on audio" once (a gesture): playback may start. */
  unlocked: boolean;
  /** Called when the browser blocks autoplay, so the room can show the one-time "Turn on audio" button. */
  onBlocked: () => void;
};

/**
 * Plays each AI speech automatically, in sync with the server clock (position = now − playStartMs), once.
 * - Mounted for the whole meeting, so the unlock survives from one speech to the next (no click per speech).
 * - Keyed by phase + audioId: re-renders and duplicate events do not restart it; a refresh resumes at the right
 *   point; a speech that has already ended is not replayed.
 * - Separate from Zoom: AI audio is played locally in each browser and is never sent into the Zoom session.
 * On any failure the captions remain; the reason is shown (generation / storage / playback).
 */
export function AiSpeechAudio({ forumId, state, now, unlocked, onBlocked }: Props) {
  const [problem, setProblem] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, string>());
  const p = state.phase;
  const ai = p.type === "SPEECH" && p.speakerKind === "ai" ? p.ai : undefined;
  const key = ai?.audioId ? `${state.phaseId}:${ai.audioId}` : null;

  useEffect(() => {
    setProblem(null);
    if (!key || !ai?.audioId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        let url = urls.current.get(ai.audioId!);
        if (!url) {
          const res = await authedFetch(`/api/forums/${forumId}/audio/${ai.audioId}`);
          if (!res.ok) throw new Error(res.status === 404 ? "missing" : `http ${res.status}`);
          url = URL.createObjectURL(await res.blob());
          urls.current.set(ai.audioId!, url);
        }
        if (stopped) return;
        const el = new Audio(url);
        audio.current = el;
        const begin = () => {
          if (stopped) return;
          const offset = Math.max(0, (now() - ai.playStartMs) / 1000);
          if (ai.durationMs && offset * 1000 >= ai.durationMs - 250) return; // joined after it ended: do not replay
          el.currentTime = offset;
          el.play().then(
            () => setProblem(null),
            (err: Error) => {
              if (err?.name === "NotAllowedError") {
                setProblem("blocked");
                onBlocked();
              } else setProblem("Audio could not be played — captions shown.");
            },
          );
        };
        const startIn = ai.playStartMs - now();
        if (startIn > 0) timer = setTimeout(begin, startIn);
        else begin();
      } catch (e) {
        setProblem((e as Error).message === "missing" ? "Audio file not found — captions shown." : "Audio could not be loaded — captions shown.");
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      audio.current?.pause();
      audio.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one playback per speech (phase + audio id); `unlocked` retries a blocked start
  }, [key, unlocked]);

  // free blob URLs of past speeches
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  if (!ai) return null;
  const reason =
    ai.audioError === "tts_failed"
      ? "Voice generation failed — captions shown."
      : ai.audioError === "store_failed"
        ? "Voice could not be stored — captions shown."
        : ai.audioError === "tts_off"
          ? "AI voice is not enabled on this server — captions shown."
          : problem && problem !== "blocked"
            ? problem
            : null;
  return reason ? (
    <p className="px-4 pb-2 text-[11px] text-purple-200" data-testid="ai-audio-status">
      {reason}
    </p>
  ) : null;
}
