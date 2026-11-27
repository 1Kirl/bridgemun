"use client";

import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { Brain } from "lucide-react";
import { db } from "@/lib/firebase";
import type { PublicForumState } from "@/engine/publicView";

type AiAction = {
  seat?: string;
  kind: string;
  ok: boolean;
  choice?: string;
  action?: string;
  summary?: string;
  evidence?: string[];
  matchLevel?: "exact" | "partial" | "none";
  sources?: Array<{ id: string; title: string; url: string; type: string; verification: string; location?: string }>;
  provider?: string;
  error?: string;
  atMs: number;
};

const TYPE: Record<string, string> = {
  official_position: "official position",
  negotiation_record: "negotiation record",
  national_context: "national facts",
  team_research: "team research",
  student_summary: "student summary",
  intl_background: "common background",
  research: "research",
  simulation_assumption: "scenario",
};

const LEVEL: Record<string, string> = {
  exact: "materials: this country & agenda",
  partial: "materials: this country, related agenda only",
  none: "no materials — general knowledge",
};

/** Short rationale summaries and the material ids AI delegations cited (no full reasoning is stored). */
export function AiRationale({ forumId, state, positionSetVersion }: { forumId: string; state: PublicForumState; positionSetVersion?: string }) {
  const [items, setItems] = useState<AiAction[]>([]);
  useEffect(
    () =>
      onSnapshot(query(collection(db, "forums", forumId, "aiActions"), orderBy("atMs", "desc"), limit(15)), (s) =>
        setItems(s.docs.map((d) => d.data() as AiAction)),
      ),
    [forumId],
  );
  return (
    <details className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <summary className="flex cursor-pointer items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-gray-800">
        <Brain size={14} className="text-purple-600" /> Why did the AI do that?
      </summary>
      {positionSetVersion && !positionSetVersion.startsWith("fixture") && positionSetVersion !== "none" && (
        <p className="mt-2 text-[10px] text-gray-400">Research set {positionSetVersion} (fixed for this forum). Labels show whether a source is an official position, a fact, research or a student summary.</p>
      )}
      {positionSetVersion?.startsWith("fixture") && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800">Position materials in use: TEST FIXTURE ({positionSetVersion}) — invented, not real research.</p>
      )}
      <ul className="mt-2 space-y-1.5">
        {items.length === 0 && <li className="text-xs text-gray-400">No AI decisions logged yet.</li>}
        {items.map((a, i) => (
          <li key={i} className="rounded-lg border border-gray-100 p-2 text-xs">
            <span className="font-bold text-gray-800">{a.seat ? state.seats[a.seat]?.countryName : "AI"}</span> · {a.kind}
            {a.choice ? ` → ${a.choice}` : a.action ? ` → ${a.action}` : ""}
            {!a.ok && <span className="text-red-600"> · not executed ({a.error})</span>}
            {a.summary && <p className="mt-0.5 text-gray-600">{a.summary}</p>}
            {a.matchLevel && (
              <p className="mt-0.5 text-[10px] text-gray-400">
                {LEVEL[a.matchLevel]}
                {a.evidence?.length && !a.sources?.length ? ` · cited: ${a.evidence.join(", ")}` : ""} · {a.provider}
              </p>
            )}
            {a.sources && a.sources.length > 0 && (
              <ul className="mt-1 space-y-0.5" data-testid="ai-sources">
                {a.sources.map((src) => (
                  <li key={src.id} className="text-[10px] leading-snug text-gray-500">
                    <span className="rounded bg-gray-100 px-1 font-bold text-gray-600">{TYPE[src.type] ?? src.type}</span>{" "}
                    {src.url ? (
                      <a href={src.url} target="_blank" rel="noreferrer noopener" className="text-brand underline">
                        {src.title}
                      </a>
                    ) : (
                      src.title
                    )}
                    {src.location ? ` (${src.location})` : ""}
                    {src.verification !== "verified" ? <span className="text-amber-700"> · {src.verification}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
