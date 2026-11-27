"use client";

import { useEffect, useRef, useState } from "react";
import { Minimize2 } from "lucide-react";

/**
 * In-app dialog over the meeting room for the delegate's own turn. The room behind stays mounted and visible
 * (dimmed). The dialog itself is kept mounted while `active` — hiding it only hides the screen, so drafts,
 * microphone state, recording/upload and timers are never reset. Backdrop clicks do nothing; Esc / "Hide"
 * hide the screen and never end the speech.
 */
export function SpeechModal({ active, hidden, onHide, children }: { active: boolean; hidden: boolean; onHide: () => void; children: React.ReactNode }) {
  const open = active && !hidden;
  // fade: stay rendered briefly after `active` ends so the fade-out can play
  const [prevActive, setPrevActive] = useState(active);
  const [lingering, setLingering] = useState(false);
  if (prevActive !== active) {
    setPrevActive(active);
    setLingering(!active);
  }
  const rendered = active || lingering;
  const [shown, setShown] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!lingering) return;
    const t = setTimeout(() => setLingering(false), 200);
    return () => clearTimeout(t);
  }, [lingering]);

  useEffect(() => {
    if (!rendered) return;
    const id = requestAnimationFrame(() => setShown(open));
    return () => cancelAnimationFrame(id);
  }, [open, rendered]);

  // focus into the dialog when it opens, back to where it was when it closes
  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const el = panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current;
      el?.focus({ preventScroll: true });
    }, 30);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      returnTo.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  // Esc hides the screen (not the speech); Tab stays inside the dialog
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onHide();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const f = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), textarea, select, input, summary, [href], [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onHide]);

  if (!rendered) return null;
  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center p-0 transition-[opacity,visibility] duration-200 ease-out motion-reduce:transition-none sm:items-center sm:p-4 ${shown ? "visible opacity-100" : "pointer-events-none invisible opacity-0"}`}
      data-testid="speech-modal"
      data-open={open ? "true" : "false"}
      aria-hidden={!open}
    >
      {/* backdrop: dims the room; clicking it does nothing (a misclick must never end or lose a speech) */}
      <div className="absolute inset-0 bg-black/55" aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Your speech"
        tabIndex={-1}
        className={`relative flex max-h-[100dvh] w-full max-w-3xl flex-col outline-none transition-transform duration-200 ease-out motion-reduce:transition-none sm:max-h-[calc(100dvh-2rem)] ${shown ? "translate-y-0" : "translate-y-3"}`}
      >
        <div className="flex shrink-0 justify-end px-2 pb-2 pt-2 sm:px-0 sm:pt-0">
          <button type="button" onClick={onHide} className="flex items-center gap-1 rounded-full bg-white/90 px-3 py-1 text-[11px] font-bold text-gray-700 shadow hover:bg-white" data-testid="hide-speech-modal" title="Hide this screen — your turn continues">
            <Minimize2 size={12} /> Hide screen (turn continues)
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
