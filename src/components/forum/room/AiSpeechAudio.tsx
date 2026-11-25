"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { authedFetch } from "@/lib/authedFetch";
import type { PublicForumState } from "@/engine/publicView";

/**
 * Plays the server-generated AI speech in sync with the server clock: position = now − playStartMs.
 * One element at a time (previous playback stops when the phase changes) → no overlapping voices.
 * Browsers block autoplay until the user interacts, so the user enables audio once per page.
 * On any failure the captions remain the source of truth.
 */
export function AiSpeechAudio({ forumId, state, now }: { forumId: string; state: PublicForumState; now: () => number }) {
  const [enabled, setEnabled] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, string>());
  const p = state.phase;
  const ai = p.type === "SPEECH" && p.speakerKind === "ai" ? p.ai : undefined;
  const key = ai?.audioId ? `${state.phaseId}:${ai.audioId}` : null;

  useEffect(() => {
    if (!enabled || !key || !ai?.audioId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        let url = urls.current.get(ai.audioId!);
        if (!url) {
          const res = await authedFetch(`/api/forums/${forumId}/audio/${ai.audioId}`);
          if (!res.ok) throw new Error(`audio ${res.status}`);
          url = URL.createObjectURL(await res.blob());
          urls.current.set(ai.audioId!, url);
        }
        if (stopped) return;
        const el = new Audio(url);
        audio.current = el;
        const startIn = ai.playStartMs - now();
        const begin = () => {
          if (stopped) return;
          const offset = Math.max(0, (now() - ai.playStartMs) / 1000);
          if (ai.durationMs && offset * 1000 >= ai.durationMs) return; // joined after it ended
          el.currentTime = offset;
          void el.play().catch(() => setProblem("Playback blocked by the browser — captions shown."));
        };
        if (startIn > 0) timer = setTimeout(begin, startIn);
        else begin();
        setProblem(null);
      } catch {
        setProblem("Audio unavailable — captions shown.");
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      audio.current?.pause();
      audio.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  return (
    <div className="flex items-center gap-2 px-4 pb-2 text-[11px] text-purple-200">
      <button type="button" onClick={() => setEnabled((x) => !x)} className="inline-flex items-center gap-1 rounded-md bg-purple-900/60 px-2 py-1 font-bold hover:bg-purple-800">
        {enabled ? <Volume2 size={12} /> : <VolumeX size={12} />} {enabled ? "AI audio on" : "Enable AI audio"}
      </button>
      {ai && !ai.audioId && <span>No audio for this speech (captions only).</span>}
      {problem && <span>{problem}</span>}
    </div>
  );
}
