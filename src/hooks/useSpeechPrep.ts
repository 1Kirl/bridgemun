"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SpeechMode = "mic" | "text";
export type MicCheck = "unknown" | "checking" | "slow" | "ready" | "denied" | "unsupported";

/**
 * Speech preparation that happens BEFORE the speaking time starts: choose microphone or text, check the microphone
 * permission, and write a text draft. Mode and draft are kept on this device (per forum and seat) so a refresh does
 * not lose them. Nothing here starts a speech or submits anything.
 */
export function useSpeechPrep(forumId: string, seat: string) {
  const key = `bridgemun:speech:${forumId}:${seat}`;
  const [mode, setModeState] = useState<SpeechMode>("mic");
  const [draft, setDraftState] = useState("");
  const [mic, setMic] = useState<MicCheck>("unknown");
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null") as { mode?: SpeechMode; draft?: string } | null;
      if (saved?.mode === "mic" || saved?.mode === "text") setModeState(saved.mode);
      if (typeof saved?.draft === "string") setDraftState(saved.draft);
    } catch {
      /* storage unavailable: start empty */
    }
    loaded.current = true;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMic("unsupported");
      return;
    }
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((p) => setMic((m) => (m === "unknown" ? (p.state === "granted" ? "ready" : p.state === "denied" ? "denied" : "unknown") : m)))
      .catch(() => {});
  }, [key]);

  const persist = useCallback(
    (next: { mode: SpeechMode; draft: string }) => {
      if (!loaded.current) return;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [key],
  );

  const setMode = (m: SpeechMode) => {
    setModeState(m);
    persist({ mode: m, draft });
  };
  const setDraft = (d: string) => {
    setDraftState(d);
    persist({ mode, draft: d });
  };
  const clearDraft = () => {
    setDraftState("");
    persist({ mode, draft: "" });
  };

  /** Asks for the microphone now (not when the speaking time runs), then releases it immediately. */
  const checkMic = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return setMic("unsupported");
    setMic("checking");
    const slow = setTimeout(() => setMic((m) => (m === "checking" ? "slow" : m)), 8000);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stream.getTracks().forEach((t) => t.stop());
      setMic("ready");
    } catch (e) {
      setMic((e as { name?: string })?.name === "NotAllowedError" ? "denied" : "unsupported");
    } finally {
      clearTimeout(slow);
    }
  }, []);

  return { mode, setMode, draft, setDraft, clearDraft, mic, checkMic };
}

export type SpeechPrep = ReturnType<typeof useSpeechPrep>;
