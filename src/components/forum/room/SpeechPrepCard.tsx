"use client";

import { CheckCircle2, Keyboard, Loader2, Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { SpeechPrep } from "@/hooks/useSpeechPrep";

/** While waiting to speak (on the speakers' list / volunteered): choose a method, check the mic, draft text. Nothing is sent. */
export function SpeechPrepCard({ prep }: { prep: SpeechPrep }) {
  return (
    <section className="rounded-2xl border border-brand/30 bg-brand-light p-4" data-testid="speech-prep">
      <p className="text-sm font-black text-brand">Prepare your speech</p>
      <p className="text-[11px] text-gray-600">You are waiting to speak. Set up now — your speaking time only starts when you press Start speech.</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(
          [
            ["mic", Mic, "Microphone"],
            ["text", Keyboard, "Text"],
          ] as const
        ).map(([m, Icon, label]) => (
          <button key={m} type="button" aria-pressed={prep.mode === m} onClick={() => prep.setMode(m)} className={`flex items-center justify-center gap-1.5 rounded-lg border-2 px-2 py-1.5 text-xs font-black ${prep.mode === m ? "border-brand bg-brand text-white" : "border-gray-200 bg-white text-gray-600"}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {prep.mode === "mic" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold">
          {prep.mic === "ready" ? (
            <span className="flex items-center gap-1 text-emerald-700">
              <CheckCircle2 size={14} /> Microphone ready
            </span>
          ) : prep.mic === "checking" ? (
            <span className="flex items-center gap-1 text-gray-600">
              <Loader2 size={14} className="animate-spin" /> Waiting for permission…
            </span>
          ) : (
            <>
              <span className="flex items-center gap-1 text-gray-600">
                <MicOff size={14} /> {prep.mic === "denied" ? "Blocked by the browser" : prep.mic === "unsupported" ? "Not available here" : prep.mic === "slow" ? "Permission not answered yet" : "Permission needed"}
              </span>
              {prep.mic !== "unsupported" && (
                <Button size="sm" variant="secondary" onClick={() => void prep.checkMic()}>
                  Check microphone
                </Button>
              )}
              <button type="button" className="underline" onClick={() => prep.setMode("text")}>
                Use text instead
              </button>
            </>
          )}
        </div>
      ) : (
        <textarea value={prep.draft} onChange={(e) => prep.setDraft(e.target.value)} rows={4} maxLength={4000} placeholder="Draft your statement (saved on this device; submit it when your turn starts)" className="mt-2 w-full rounded-lg border border-gray-200 bg-white p-2 text-sm" />
      )}
    </section>
  );
}
