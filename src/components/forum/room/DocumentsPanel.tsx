"use client";

import { useState } from "react";
import { FileText, PenLine, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { PublicForumState } from "@/engine/publicView";
import { effectiveDocThresholds } from "@/engine/documents";
import type { AmendmentOp, DocumentState } from "@/engine/types";
import type { useForumActions } from "@/hooks/useForumActions";

type Props = { state: PublicForumState; mySeat: string; actions: ReturnType<typeof useForumActions> };
const box = "rounded-2xl border border-gray-100 bg-white p-4 shadow-sm";
const lines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);

const STATUS: Record<DocumentState["status"], string> = {
  draft: "draft — not yet approved",
  approved: "approved — can be introduced",
  introduced: "introduced — text changes only by amendment",
  adopted: "ADOPTED",
  failed: "not adopted",
  not_voted: "not voted (no quorum)",
};

/** Working papers / draft resolutions / amendments (HMUN rules 24–29; approval checks replace the Director). */
export function DocumentsPanel({ state, mySeat, actions }: Props) {
  const [creating, setCreating] = useState(false);
  const docs = Object.values(state.documents).sort((a, b) => a.submittedAtMs - b.submittedAtMs);
  const members = Object.keys(state.seats).length;
  const t = effectiveDocThresholds(members, state.settings.documents);
  const present = state.seats[mySeat].attendance !== "not_recorded";
  const canWrite = present && !state.debateClosed && state.phase.type !== "CLOSED";

  return (
    <div className={box}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-gray-800">
          <FileText size={14} className="text-brand" /> Documents
        </h3>
        {canWrite && !creating && (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus size={13} className="mr-1" /> New draft
          </Button>
        )}
      </div>
      <p className="mb-2 text-[11px] text-gray-500">
        A draft resolution is approved automatically (app stand-in for the Director, rule 26) with ≥{t.sponsors} sponsors, ≥{t.signatories} signatories,
        ≥{state.settings.documents.minPreambular} preambular and ≥{state.settings.documents.minOperative} operative clauses. Signing means “worth debating”, not support (rule 24).
      </p>
      {creating && <DraftForm onCancel={() => setCreating(false)} onSubmit={async (d) => (await actions.send({ type: "submit_document", seat: mySeat, ...d })) && setCreating(false)} busy={actions.busy} />}
      {docs.length === 0 && !creating && <p className="text-xs text-gray-400">No documents yet.</p>}
      <div className="space-y-3">
        {docs.map((d) => (
          <DocCard key={d.id} d={d} state={state} mySeat={mySeat} actions={actions} canWrite={canWrite} amendSigs={t.amendmentSignatories} />
        ))}
      </div>
    </div>
  );
}

function DraftForm({ onSubmit, onCancel, busy, initial }: { onSubmit: (d: { kind: "draft_resolution" | "working_paper"; title: string; preambular: string[]; operative: string[] }) => void; onCancel: () => void; busy: boolean; initial?: DocumentState }) {
  const [kind, setKind] = useState<"draft_resolution" | "working_paper">(initial?.kind ?? "draft_resolution");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [pre, setPre] = useState(initial?.preambular.join("\n") ?? "");
  const [op, setOp] = useState(initial?.operative.join("\n") ?? "");
  return (
    <div className="mb-3 space-y-2 rounded-xl border border-brand/20 bg-brand/5 p-3 text-sm">
      {!initial && (
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="w-full rounded-lg border border-gray-200 p-2">
          <option value="draft_resolution">Draft resolution</option>
          <option value="working_paper">Working paper</option>
        </select>
      )}
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full rounded-lg border border-gray-200 p-2" disabled={!!initial} />
      <textarea value={pre} onChange={(e) => setPre(e.target.value)} rows={3} placeholder={"Preambular clauses, one per line\nRecalling …"} className="w-full rounded-lg border border-gray-200 p-2" />
      <textarea value={op} onChange={(e) => setOp(e.target.value)} rows={4} placeholder={"Operative clauses, one per line\nCalls upon …"} className="w-full rounded-lg border border-gray-200 p-2" />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !title.trim() || !lines(op).length} onClick={() => onSubmit({ kind, title, preambular: lines(pre), operative: lines(op) })}>
          {initial ? "Save new version" : "Submit"}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function DocCard({ d, state, mySeat, actions, canWrite, amendSigs }: { d: DocumentState; state: PublicForumState; mySeat: string; actions: Props["actions"]; canWrite: boolean; amendSigs: number }) {
  const [editing, setEditing] = useState(false);
  const [amending, setAmending] = useState(false);
  const name = (s: string) => state.seats[s]?.countryName ?? s;
  const isSponsor = d.sponsors.includes(mySeat);
  const isSigned = d.signatories.includes(mySeat);
  const open = d.status === "draft" || d.status === "approved";
  const amendments = Object.values(state.amendments).filter((a) => a.targetDocId === d.id);
  const p = state.phase;
  const awaitingMyResponse = p.type === "AMENDMENT_SPONSOR_RESPONSE" && isSponsor && state.amendments[p.amendmentId]?.targetDocId === d.id && !p.responses[mySeat];

  return (
    <div className="rounded-xl border border-gray-100 p-3 text-xs" data-testid={`doc-${d.id}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-black text-gray-900">
          {d.title} <span className="font-normal text-gray-400">v{d.version} · {d.kind === "working_paper" ? "working paper" : "draft resolution"}</span>
        </p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${d.status === "adopted" ? "bg-emerald-100 text-emerald-800" : d.status === "approved" ? "bg-brand-light text-brand" : "bg-gray-100 text-gray-600"}`}>{STATUS[d.status]}</span>
      </div>
      <p className="mt-1 text-gray-500">
        Sponsors: {d.sponsors.map(name).join(", ") || "—"} · Signatories: {d.signatories.map(name).join(", ") || "—"}
      </p>
      {d.kind === "draft_resolution" && <DocPipeline d={d} state={state} />}
      <div className="mt-2 space-y-1 text-gray-700">
        {d.preambular.map((x, i) => (
          <p key={`p${i}`} className="italic">{x}</p>
        ))}
        {d.operative.map((x, i) => (
          <p key={`o${i}`}>
            <b>{i + 1}.</b> {x}
          </p>
        ))}
      </div>
      {state.divisions?.[d.id]?.outcome && (
        <p className="mt-2 rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-700">
          Division of the question (rule 33):{" "}
          {state.divisions[d.id].outcome === "intact"
            ? "no division passed; text voted intact."
            : state.divisions[d.id].outcome === "rejected_as_whole"
              ? "every divided part was rejected; the resolution is rejected as a whole."
              : `divided parts voted; recombined from v${state.divisions[d.id].baseVersion}.`}
        </p>
      )}
      {editing && <DraftForm initial={d} busy={actions.busy} onCancel={() => setEditing(false)} onSubmit={async (v) => (await actions.send({ type: "update_document", seat: mySeat, docId: d.id, preambular: v.preambular, operative: v.operative })) && setEditing(false)} />}
      {canWrite && open && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {!isSponsor && <Button size="sm" variant="outline" disabled={actions.busy} onClick={() => void actions.send({ type: "sign_document", seat: mySeat, docId: d.id, role: "sponsor" })}>Sponsor</Button>}
          {!isSponsor && !isSigned && <Button size="sm" variant="outline" disabled={actions.busy} onClick={() => void actions.send({ type: "sign_document", seat: mySeat, docId: d.id, role: "signatory" })}>Sign</Button>}
          {isSponsor && !editing && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><PenLine size={12} className="mr-1" />Edit</Button>}
        </div>
      )}
      {d.status === "introduced" && canWrite && !amending && (
        <Button size="sm" variant="outline" className="mt-2" onClick={() => setAmending(true)}>Propose amendment</Button>
      )}
      {amending && <AmendmentForm d={d} busy={actions.busy} onCancel={() => setAmending(false)} onSubmit={async (op) => (await actions.send({ type: "submit_amendment", seat: mySeat, targetDocId: d.id, op })) && setAmending(false)} />}
      {awaitingMyResponse && p.type === "AMENDMENT_SPONSOR_RESPONSE" && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
          <p className="font-bold text-amber-900">You sponsor this resolution: do you accept amendment {p.amendmentId} as friendly?</p>
          <div className="mt-1 flex gap-2">
            <Button size="sm" disabled={actions.busy} onClick={() => void actions.send({ type: "sponsor_response", seat: mySeat, amendmentId: p.amendmentId, agree: true })}>Accept (friendly)</Button>
            <Button size="sm" variant="outline" disabled={actions.busy} onClick={() => void actions.send({ type: "sponsor_response", seat: mySeat, amendmentId: p.amendmentId, agree: false })}>Object</Button>
          </div>
        </div>
      )}
      {amendments.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-gray-100 pt-2">
          {amendments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-1.5">
              <b>{a.id}</b> by {name(a.proposer)}: {a.op.kind} clause {a.op.clauseIndex + 1}
              {"text" in a.op ? ` → “${a.op.text}”` : ""} · signatories {a.signatories.length}/{amendSigs} ·{" "}
              <span className="font-bold">{a.status.replace(/_/g, " ")}</span>
              {a.friendlyOutcome && (
                <span className="text-gray-500">
                  (
                  {a.friendlyOutcome === "all_agreed"
                    ? "all sponsors agreed — friendly"
                    : a.friendlyOutcome === "objected"
                      ? "a sponsor objected — unfriendly"
                      : "sponsor consent not obtained in time; no objection recorded (app policy D5) — unfriendly"}
                  )
                </span>
              )}
              {a.status === "draft" && canWrite && a.proposer !== mySeat && !a.signatories.includes(mySeat) && (
                <Button size="sm" variant="outline" disabled={actions.busy} onClick={() => void actions.send({ type: "sign_amendment", seat: mySeat, amendmentId: a.id })}>Sign amendment</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AmendmentForm({ d, onSubmit, onCancel, busy }: { d: DocumentState; onSubmit: (op: AmendmentOp) => void; onCancel: () => void; busy: boolean }) {
  const [kind, setKind] = useState<AmendmentOp["kind"]>("replace");
  const [idx, setIdx] = useState(1);
  const [text, setText] = useState("");
  const op: AmendmentOp = kind === "delete" ? { kind, clauseIndex: idx - 1 } : { kind, clauseIndex: idx - 1, text };
  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-gray-200 p-2">
      <div className="flex gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as AmendmentOp["kind"])} className="rounded border border-gray-200 p-1">
          <option value="replace">Replace operative clause</option>
          <option value="insert">Insert before clause</option>
          <option value="delete">Delete operative clause</option>
        </select>
        <input type="number" min={1} max={d.operative.length + (kind === "insert" ? 1 : 0)} value={idx} onChange={(e) => setIdx(Number(e.target.value))} className="w-16 rounded border border-gray-200 p-1" />
      </div>
      {kind !== "delete" && <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="New clause text" className="w-full rounded border border-gray-200 p-1" />}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || (kind !== "delete" && !text.trim())} onClick={() => onSubmit(op)}>Submit amendment</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
      <p className="text-[10px] text-gray-400">Then collect signatures and move “Introduce an amendment” when the floor is open (rule 29).</p>
    </div>
  );
}

const PIPE = [
  { id: "draft", label: "Draft" },
  { id: "approved", label: "Approved" },
  { id: "introduced", label: "Introduced" },
  { id: "voted", label: "Voted" },
] as const;

/** Resolution lifecycle with signature progress toward automatic approval (counts only, from the engine thresholds). */
function DocPipeline({ d, state }: { d: DocumentState; state: PublicForumState }) {
  const t = effectiveDocThresholds(Object.keys(state.seats).length, state.settings.documents);
  const idx = d.status === "draft" ? 0 : d.status === "approved" ? 1 : d.status === "introduced" ? 2 : 3;
  const final = d.status === "adopted" ? "Adopted" : d.status === "failed" ? "Not adopted" : d.status === "not_voted" ? "Not voted (no quorum)" : null;
  return (
    <div className="mt-2 space-y-1.5" data-testid={`doc-pipeline-${d.id}`}>
      <ol className="flex items-center gap-1">
        {PIPE.map((st, i) => (
          <li key={st.id} className="flex items-center gap-1">
            {i > 0 && <span className={`h-0.5 w-3 ${i <= idx ? "bg-brand" : "bg-gray-200"}`} />}
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${i < idx ? "bg-brand-light text-brand" : i === idx ? (st.id === "voted" ? (d.status === "adopted" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white") : "bg-brand text-white") : "bg-gray-100 text-gray-400"}`}>
              {i === 3 && final ? final : st.label}
            </span>
          </li>
        ))}
      </ol>
      {(d.status === "draft" || d.status === "approved") && (
        <div className="grid grid-cols-2 gap-2">
          <Meter label="Sponsors" n={d.sponsors.length} need={t.sponsors} />
          <Meter label="Signatories" n={d.signatories.length} need={t.signatories} />
        </div>
      )}
    </div>
  );
}

function Meter({ label, n, need }: { label: string; n: number; need: number }) {
  const ok = n >= need;
  return (
    <div>
      <p className="flex justify-between text-[10px] font-bold text-gray-600">
        <span>{label}</span>
        <span className={ok ? "text-emerald-700" : ""}>
          {n} / {need} needed {ok ? "✓" : ""}
        </span>
      </p>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full ${ok ? "bg-emerald-500" : "bg-brand"}`} style={{ width: `${need ? Math.min(100, (n / need) * 100) : 100}%` }} />
      </div>
    </div>
  );
}
