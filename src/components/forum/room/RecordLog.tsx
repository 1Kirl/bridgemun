"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Bot, Gavel, MessageSquare, Timer, User, Vote } from "lucide-react";
import type { PublicForumState } from "@/engine/publicView";
import type { RecordEntry } from "@/engine/types";
import { Flag } from "./Visuals";

type Kind = "speech_human" | "speech_ai" | "motion" | "result" | "auto" | "chair";

function kindOf(r: RecordEntry): Kind {
  if (r.kind === "response_timeout" || r.kind === "not_awaited") return "auto";
  if (r.source === "ai_speech") return "speech_ai";
  if (r.source.startsWith("human_")) return "speech_human";
  if (/ADOPTED|FAILED|NOT ADOPTED|INCLUDED|EXCLUDED|NOT HELD/.test(r.text)) return "result";
  if (/^Motion|motion|introduced/.test(r.text)) return "motion";
  return "chair";
}

const STYLE: Record<Kind, { cls: string; label: string; icon: typeof Gavel }> = {
  speech_human: { cls: "bg-white ring-1 ring-brand/20", label: "Speech", icon: User },
  speech_ai: { cls: "bg-purple-50 ring-1 ring-purple-100", label: "Speech (AI)", icon: Bot },
  motion: { cls: "bg-sky-50", label: "Motion", icon: Gavel },
  result: { cls: "bg-emerald-50", label: "Result", icon: Vote },
  auto: { cls: "bg-amber-50 ring-1 ring-amber-200", label: "Automatic step", icon: Timer },
  chair: { cls: "bg-gray-50", label: "Chair", icon: Gavel },
};

/**
 * The meeting log in the centre: a chat-like, fixed-height list (scrolls inside). It follows new entries while the
 * reader is at the bottom; when they scroll up to read, it stays put and offers "Jump to latest".
 */
export function RecordLog({ state, record }: { state: PublicForumState; record: RecordEntry[] }) {
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const seen = useRef(record.length);
  // Entries already present when the log mounted never animate; later ones rise in once (same key → no re-mount).
  const lastSeq = record.length ? record[record.length - 1].seq : -1;
  const [firstSeq, setFirstSeq] = useState(lastSeq);
  const [prevLen, setPrevLen] = useState(record.length);
  if (prevLen !== record.length) {
    setPrevLen(record.length);
    if (record.length - prevLen > 3) setFirstSeq(lastSeq); // initial load / reconnect batch: no animation
  }
  const [unread, setUnread] = useState(0);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom.current) setUnread(0);
  };
  const jump = () => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    setUnread(0);
  };

  // first render: start at the latest entry
  useLayoutEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // only a NEW entry can move the view, and only if the reader was already at the bottom
  useEffect(() => {
    const added = record.length - seen.current;
    seen.current = record.length;
    if (added <= 0) return;
    if (atBottom.current) {
      const el = box.current;
      if (el) el.scrollTop = el.scrollHeight;
    } else setUnread((n) => n + added);
  }, [record.length]);

  return (
    <section className="bm-card bm-tone-sky relative rounded-2xl p-4" data-testid="record-log">
      <h3 className="bm-heading mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-gray-800">
        <MessageSquare size={14} className="text-brand" /> Record
      </h3>
      <div ref={box} onScroll={onScroll} className="h-[240px] space-y-1.5 overflow-y-auto pr-1 custom-scrollbar" data-testid="record-scroll">
        {record.length === 0 && <p className="text-xs text-gray-400">Speeches, motions, results and automatic steps will appear here.</p>}
        {record.map((r) => {
          const k = kindOf(r);
          const st = STYLE[k];
          const seat = r.seat ? state.seats[r.seat] : null;
          const long = r.text.length > 220;
          return (
            <div key={r.seq} className={`rounded-xl px-3 py-1.5 text-sm ${st.cls} ${r.seq > firstSeq ? "bm-enter" : ""}`} data-kind={k}>
              <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-gray-500">
                {seat ? <Flag code={seat.id} className="h-3 w-4" /> : <st.icon size={11} />}
                <span className="text-gray-700">{seat ? seat.countryName : "Chair (automatic)"}</span>
                {seat && <span className={seat.kind === "ai" ? "text-purple-600" : "text-brand"}>{seat.kind === "ai" ? "AI" : "Human"}</span>}
                <span className="rounded bg-white/70 px-1">{st.label}</span>
                <span className="ml-auto font-normal normal-case">{new Date(r.atMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              </div>
              {long ? (
                <details>
                  <summary className="cursor-pointer list-none text-gray-800">
                    {r.text.slice(0, 200)}… <span className="text-xs font-bold text-brand">more</span>
                  </summary>
                  <p className="text-gray-800">{r.text}</p>
                </details>
              ) : (
                <p className="text-gray-800">{r.text}</p>
              )}
            </div>
          );
        })}
      </div>
      {unread > 0 && (
        <button type="button" onClick={jump} className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-brand px-3 py-1 text-xs font-bold text-white shadow-lg" data-testid="jump-latest">
          <ArrowDown size={13} /> {unread} new — Jump to latest
        </button>
      )}
    </section>
  );
}
