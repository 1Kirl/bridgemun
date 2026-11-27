"use client";

import { useCallback, useRef, useState } from "react";
import { FilePlus2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { useForumActions } from "@/hooks/useForumActions";

type Kind = "draft_resolution" | "working_paper";
type Draft = { open: boolean; kind: Kind; title: string; pre: string; op: string };
const EMPTY: Draft = { open: false, kind: "draft_resolution", title: "", pre: "", op: "" };
const lines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);

/** New-document draft kept on this device (survives closing the editor, switching panels and reloading). */
export function useDocDraft(forumId: string, seat: string) {
  const key = `bridgemun:doc:${forumId}:${seat}`;
  // The room renders only on the client (after sign-in and the live state load), so storage can be read at init.
  const [d, setD] = useState<Draft>(() => {
    try {
      const saved = typeof window === "undefined" ? null : (JSON.parse(localStorage.getItem(key) ?? "null") as Partial<Draft> | null);
      return saved ? { ...EMPTY, ...saved } : EMPTY;
    } catch {
      return EMPTY; // storage unavailable
    }
  });
  const loaded = useRef(true);
  const update = useCallback(
    (patch: Partial<Draft>) =>
      setD((cur) => {
        const next = { ...cur, ...patch };
        if (loaded.current) {
          try {
            localStorage.setItem(key, JSON.stringify(next));
          } catch {
            /* ignore */
          }
        }
        return next;
      }),
    [key],
  );
  const hasContent = !!(d.title.trim() || d.pre.trim() || d.op.trim());
  return { draft: d, update, hasContent, open: () => update({ open: true }), close: () => update({ open: false }), reset: () => update({ ...EMPTY }) };
}
export type DocDraft = ReturnType<typeof useDocDraft>;

/** Wide editor in the centre of the room. Submitting sends one submit_document command; nothing is sent automatically. */
export function DraftEditor({ doc, mySeat, actions }: { doc: DocDraft; mySeat: string; actions: ReturnType<typeof useForumActions> }) {
  const d = doc.draft;
  const [failed, setFailed] = useState(false);
  const submit = async () => {
    setFailed(false);
    const ok = await actions.send({ type: "submit_document", seat: mySeat, kind: d.kind, title: d.title, preambular: lines(d.pre), operative: lines(d.op) });
    if (ok) doc.reset();
    else setFailed(true);
  };
  return (
    <section className="rounded-2xl border-2 border-brand/40 bg-white p-4 shadow-sm" data-testid="draft-editor">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-black text-brand">
          <FilePlus2 size={16} /> New document
        </p>
        <button type="button" onClick={doc.close} className="flex items-center gap-1 text-xs font-bold text-gray-500" aria-label="Close editor (draft is kept)">
          <X size={14} /> Close (draft kept)
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[200px_1fr]">
        <select value={d.kind} onChange={(e) => doc.update({ kind: e.target.value as Kind })} className="rounded-lg border border-gray-200 p-2 text-sm">
          <option value="draft_resolution">Draft resolution</option>
          <option value="working_paper">Working paper</option>
        </select>
        <input value={d.title} onChange={(e) => doc.update({ title: e.target.value })} placeholder="Title" className="rounded-lg border border-gray-200 p-2 text-sm" data-testid="draft-title" />
      </div>
      <label className="mt-3 block text-xs font-bold text-gray-600">Preambular clauses (one per line)</label>
      <textarea value={d.pre} onChange={(e) => doc.update({ pre: e.target.value })} rows={4} placeholder="Recalling …" className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm" />
      <label className="mt-2 block text-xs font-bold text-gray-600">Operative clauses (one per line)</label>
      <textarea value={d.op} onChange={(e) => doc.update({ op: e.target.value })} rows={6} placeholder="Calls upon …" className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm" data-testid="draft-operative" />
      {failed && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700">Not submitted{actions.error ? ` — ${actions.error}` : ""}. Your draft is kept; try again.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={actions.busy || !d.title.trim() || !lines(d.op).length} onClick={() => void submit()}>
          Submit document
        </Button>
        <Button variant="outline" onClick={doc.reset}>
          Discard
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-gray-500">After submitting, the document appears in Documents (side panel), where delegations sponsor and sign it.</p>
    </section>
  );
}
