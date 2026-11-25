"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { auth } from "@/lib/firebase";
import { explainError, forumApi } from "@/lib/forumClient";
import { phaseDeadlineOf } from "@/lib/phaseText";
import type { PublicForumState } from "@/engine/publicView";
import type { Command, Expectation } from "@/engine/types";

/**
 * Sends delegate commands, keeps presence fresh, and nudges the server when a deadline has passed
 * by server time but no scheduled tick arrived (e.g. dev server restarted). The server decides;
 * the client never advances the meeting itself.
 */
export function useForumActions(forumId: string, state: PublicForumState | null, serverNow: () => number, active: boolean) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (command: Command, expect?: Expectation) => {
      setBusy(true);
      setError(null);
      try {
        await forumApi.command(forumId, command, expect);
        return true;
      } catch (e) {
        setError(explainError(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [forumId],
  );

  // presence: heartbeat while the page is open, offline beacon when it closes
  useEffect(() => {
    if (!active) return;
    // Keep a fresh ID token in memory so the offline beacon can be sent synchronously on pagehide
    // (an async token lookup would not finish before the page is torn down).
    let token: string | null = null;
    const beat = async () => {
      token = (await auth.currentUser?.getIdToken().catch(() => null)) ?? token;
      await forumApi.presence(forumId, true).catch(() => {});
    };
    void beat();
    const t = setInterval(() => void beat(), 20_000);
    const bye = () => {
      if (!token) return;
      void fetch(`/api/forums/${forumId}/presence`, {
        method: "POST",
        keepalive: true,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ online: false }),
      }).catch(() => {});
    };
    window.addEventListener("pagehide", bye);
    return () => {
      clearInterval(t);
      window.removeEventListener("pagehide", bye);
    };
  }, [forumId, active]);

  // deadline nudge (idempotent on the server; only applied if the deadline really passed)
  const nudged = useRef<string>("");
  const deadline = state ? (state.paused ? state.paused.autoResumeAtMs : phaseDeadlineOf(state)) : null;
  const key = state ? `${state.phaseId}:${deadline}` : "";
  const overdue = deadline !== null && serverNow() > deadline + 2000;
  useEffect(() => {
    if (!active || !overdue || nudged.current === key) return;
    nudged.current = key;
    void forumApi.nudge(forumId).catch(() => {});
  }, [active, overdue, key, forumId]);

  return { send, busy, error, clearError: () => setError(null) };
}
