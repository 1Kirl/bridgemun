'use client';

import { Check, X, Mic, Hand, Shield, Loader2, Sparkles, Vote } from 'lucide-react';
import type { SpeakRequest } from '@/hooks/useSpeakQueue';
import type { AISuggestion } from '@/hooks/useAISuggestions';

type Props = {
  requests: SpeakRequest[];
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
  onEndSession?: () => void;
  emptyCountries: Array<{ name: string; code: string; isAI?: boolean }>;
  aiSuggestions: AISuggestion[];
  aiLoading: boolean;
  /** Which country card is currently running Generate (per-card progress). */
  loadingCountryCode?: string | null;
  /** While AI is choosing PRO vs CON for a suggestion. */
  aiPickLoadingId?: string | null;
  onGenerateAISuggestion: (countryCode: string) => void;
  onPublishAISuggestion: (suggestion: AISuggestion, stance: 'pro' | 'con') => void;
  onAutoPublishAISuggestion: (suggestion: AISuggestion) => void;
  onRejectAISuggestion: (suggestionId: string) => void;
  onToggleCountryAI: (countryCode: string, enabled: boolean) => void;
  /** Live session floor voting (QA: vote during forum, not only at end). */
  forumStatus?: string;
  votingOpen?: boolean;
  ballotsFinalized?: boolean;
  onVotingOpenChange?: (open: boolean) => void;
};

function compareRequestTime(a: SpeakRequest, b: SpeakRequest): number {
  const ta = a.createdAt?.toDate?.();
  const tb = b.createdAt?.toDate?.();
  if (ta instanceof Date && !Number.isNaN(ta.getTime()) && tb instanceof Date && !Number.isNaN(tb.getTime())) {
    return ta.getTime() - tb.getTime();
  }
  return 0;
}

export default function ModeratorPanel({
  requests,
  onApprove,
  onReject,
  onEndSession,
  emptyCountries,
  aiSuggestions,
  aiLoading,
  loadingCountryCode,
  aiPickLoadingId,
  onGenerateAISuggestion,
  onPublishAISuggestion,
  onAutoPublishAISuggestion,
  onRejectAISuggestion,
  onToggleCountryAI,
  forumStatus,
  votingOpen,
  ballotsFinalized,
  onVotingOpenChange,
}: Props) {
  const pending = requests
    .filter((r) => r.status === 'pending')
    .sort(compareRequestTime);
  const approved = requests.find((r) => r.status === 'approved');
  const generatedSuggestions = aiSuggestions.filter((s) => s.status === 'generated');

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-brand/20 bg-brand/5 p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Shield size={14} className="text-brand" />
        <h3 className="text-[11px] font-black text-brand uppercase tracking-[0.2em]">
          Moderator
        </h3>
        <div className="ml-auto flex items-center gap-2">
          {pending.length > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[9px] font-black text-white animate-pulse">
              {pending.length}
            </span>
          )}
          <button
            type="button"
            onClick={onEndSession}
            className="flex items-center gap-1.5 rounded-lg bg-red-500/10 px-2.5 py-1 text-[9px] font-black text-red-600 transition-all hover:bg-red-500 hover:text-white uppercase tracking-wider border border-red-500/20"
          >
            End Forum Session
          </button>
        </div>
      </div>

      {forumStatus === 'active' && onVotingOpenChange && !ballotsFinalized && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5">
          <div className="mb-1.5 flex items-center gap-1.5">
            <Vote size={12} className="text-amber-700" />
            <p className="text-[9px] font-black uppercase tracking-widest text-amber-900">
              Floor voting
            </p>
          </div>
          <p className="mb-2 text-[10px] leading-snug text-amber-900/80">
            Open voting while the forum is live so delegates can cast ballots before the
            session ends.
          </p>
          <button
            type="button"
            onClick={() => onVotingOpenChange(!votingOpen)}
            className="w-full rounded-lg bg-amber-600 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white transition-colors hover:bg-amber-700"
          >
            {votingOpen ? 'Close floor voting' : 'Open floor voting'}
          </button>
        </div>
      )}

      {approved ? (
        <div className="flex items-center gap-2 rounded-xl bg-green-50 border border-green-100 px-3 py-2">
          <Mic size={12} className="text-green-600 animate-pulse shrink-0" />
          <span className="text-xs font-bold text-green-700 truncate">
            Speaking: {approved.userName}
          </span>
        </div>
      ) : (
        <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
          <span className="text-xs font-semibold text-gray-400">No active speaker</span>
        </div>
      )}

      {pending.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
            Speak Requests <span className="font-semibold text-gray-400">(first requested = #1)</span>
          </p>
          {pending.map((req, idx) => (
            <div
              key={req.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 bg-white px-3 py-2 shadow-sm"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-black text-brand">
                  {idx + 1}
                </span>
                <Hand size={11} className="shrink-0 text-brand" />
                <span className="truncate text-xs font-bold text-gray-800">{req.userName}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onApprove(req.id)}
                  className="flex h-10 min-w-10 items-center justify-center rounded-lg bg-green-500 px-2 text-white transition-colors hover:bg-green-600"
                  title="Approve"
                >
                  <Check size={18} strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  onClick={() => onReject(req.id)}
                  className="flex h-10 min-w-10 items-center justify-center rounded-lg bg-red-500 px-2 text-white transition-colors hover:bg-red-600"
                  title="Reject"
                >
                  <X size={18} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="h-px bg-brand/10" />

      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
          Empty Countries
        </p>
        {emptyCountries.length === 0 ? (
          <span className="text-[10px] text-gray-400">
            No empty countries available
          </span>
        ) : (
          <div className="flex min-w-0 w-full gap-2.5 overflow-x-auto pb-1 custom-scrollbar">
            {emptyCountries.map((c) => {
              const isGenerating = aiLoading && loadingCountryCode === c.code;
              return (
              <div
                key={c.code}
                className="flex min-w-[148px] max-w-[200px] shrink-0 flex-col gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/30 px-3 py-2 select-none"
              >
                <div className="flex items-center gap-2.5">
                  <div className="h-6 w-8 shrink-0 overflow-hidden rounded border border-black/5 shadow-sm grayscale">
                    <img
                      src={`https://flagcdn.com/w40/${c.code}.png`}
                      className="h-full w-full object-cover"
                      alt=""
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-black uppercase tracking-tighter text-slate-600">
                      {c.name}
                    </p>
                    {!c.isAI && (
                      <p className="truncate text-[9px] font-bold tracking-tight text-slate-300">
                        Waiting...
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => onToggleCountryAI(c.code, !c.isAI)}
                    className={`w-full rounded-lg border px-2 py-1.5 text-[8px] font-black uppercase tracking-wider transition-colors ${
                      c.isAI
                        ? "border-purple-300 bg-purple-600 text-white hover:bg-purple-700"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    AI {c.isAI ? "on" : "off"}
                  </button>
                  {c.isAI && (
                    <button
                      type="button"
                      onClick={() => onGenerateAISuggestion(c.code)}
                      disabled={aiLoading}
                      className="relative w-full overflow-hidden rounded-lg border border-purple-200 bg-purple-50 px-2 py-1.5 text-[8px] font-black uppercase tracking-wider text-purple-800 transition-colors hover:bg-purple-600 hover:text-white disabled:opacity-50"
                    >
                      {isGenerating && (
                        <span className="pointer-events-none absolute inset-0 z-0 animate-pulse bg-purple-300/35" />
                      )}
                      <span className="relative z-10 flex items-center justify-center gap-1.5">
                        {isGenerating ? (
                          <>
                            <Loader2 size={12} className="animate-spin" />
                            Generating…
                          </>
                        ) : (
                          "Generate"
                        )}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            );
            })}
          </div>
        )}
      </div>

      {generatedSuggestions.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
            AI Suggestions
          </p>
          {generatedSuggestions.map((s) => {
            const pro = s.candidates.find((c) => c.stance === 'pro');
            const con = s.candidates.find((c) => c.stance === 'con');
            const pickBusy = aiPickLoadingId === s.id;
            return (
              <div
                key={s.id}
                className="rounded-xl border border-purple-100 bg-white p-3 shadow-sm"
              >
                <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-purple-700">
                  {s.countryName}
                </p>
                <div className="space-y-2">
                  {pro && (
                    <div className="flex flex-col gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] font-black uppercase tracking-wider text-emerald-800">
                          PRO
                        </span>
                        <button
                          type="button"
                          onClick={() => onPublishAISuggestion(s, 'pro')}
                          className="shrink-0 rounded-md bg-emerald-600 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-white hover:bg-emerald-700"
                        >
                          Publish
                        </button>
                      </div>
                      <p className="select-text cursor-text break-words text-[11px] font-medium leading-relaxed text-emerald-950">
                        {pro.text}
                      </p>
                      {pro.rationale ? (
                        <p className="select-text cursor-text break-words text-[10px] leading-snug text-emerald-800/90">
                          {pro.rationale}
                        </p>
                      ) : null}
                    </div>
                  )}
                  {con && (
                    <div className="flex flex-col gap-1.5 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] font-black uppercase tracking-wider text-amber-950">
                          CON
                        </span>
                        <button
                          type="button"
                          onClick={() => onPublishAISuggestion(s, 'con')}
                          className="shrink-0 rounded-md bg-amber-600 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-white hover:bg-amber-700"
                        >
                          Publish
                        </button>
                      </div>
                      <p className="select-text cursor-text break-words text-[11px] font-medium leading-relaxed text-amber-950">
                        {con.text}
                      </p>
                      {con.rationale ? (
                        <p className="select-text cursor-text break-words text-[10px] leading-snug text-amber-900/90">
                          {con.rationale}
                        </p>
                      ) : null}
                    </div>
                  )}
                  {pro && con && (
                    <button
                      type="button"
                      onClick={() => onAutoPublishAISuggestion(s)}
                      disabled={!!aiPickLoadingId || !!aiLoading}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-violet-300 bg-violet-50 py-2 text-[10px] font-black uppercase tracking-wider text-violet-800 transition-colors hover:bg-violet-600 hover:text-white disabled:opacity-50"
                    >
                      {pickBusy ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Sparkles size={14} />
                      )}
                      AI pick &amp; publish
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onRejectAISuggestion(s.id)}
                    className="w-full rounded-lg border border-gray-200 px-2 py-2 text-[10px] font-bold text-gray-500 hover:bg-gray-100"
                  >
                    Reject
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
