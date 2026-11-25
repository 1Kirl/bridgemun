"use client";

import { useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/authedFetch";
import type { PublicForumState } from "@/engine/publicView";

export type RecorderStatus = "idle" | "recording" | "uploading" | "uploaded" | "unavailable" | "error";

/**
 * Records the delegate's OWN microphone while they hold the floor (independent of Zoom, which only
 * carries live audio to others) and uploads it for transcription when the speech ends. The transcript
 * becomes part of the record only after the engine's confirmation step.
 */
export function useSpeechRecorder(forumId: string, state: PublicForumState, mySeat: string) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [detail, setDetail] = useState<string>("");
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const p = state.phase;
  const speakingNow = p.type === "SPEECH" && p.seat === mySeat && p.speakerKind === "human";
  const awaitingMine = p.type === "SPEECH_CONFIRM" && p.seat === mySeat;
  const awaitingRef = useRef(awaitingMine);
  awaitingRef.current = awaitingMine;

  useEffect(() => {
    if (!speakingNow || rec.current) return;
    let cancelled = false;
    (async () => {
      try {
        if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
        const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        chunks.current = [];
        r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
        r.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
          const seconds = Math.round((Date.now() - started.current) / 1000);
          rec.current = null;
          // Wait briefly for the server to move into the confirmation step, then upload once.
          for (let i = 0; i < 20 && !awaitingRef.current; i++) await new Promise((res) => setTimeout(res, 150));
          if (!awaitingRef.current) return setStatus("idle"); // speech replaced by text, or phase moved on
          setStatus("uploading");
          const fd = new FormData();
          fd.append("audio", blob, "speech");
          fd.append("seconds", String(seconds));
          const res = await authedFetch(`/api/forums/${forumId}/transcribe`, { method: "POST", body: fd }).catch(() => null);
          const out = (await res?.json().catch(() => ({}))) as { status?: string; provider?: string; error?: string };
          setStatus(res?.ok ? "uploaded" : "error");
          setDetail(res?.ok ? `transcription ${out.status} (${out.provider})` : (out.error ?? "upload failed"));
        };
        started.current = Date.now();
        r.start(1000);
        rec.current = r;
        setStatus("recording");
      } catch {
        setStatus("unavailable");
        setDetail("Microphone not available — please use the text option.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [speakingNow, forumId]);

  useEffect(() => {
    if (!speakingNow && rec.current && rec.current.state === "recording") rec.current.stop();
  }, [speakingNow]);

  return { status, detail };
}
