"use client";

import { ArrowLeft, ArrowRight, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

type Props = {
  forumTopic: string;
  /** Optional narrow focus line under the topic */
  forumSubtopic?: string;
  /** 서브타이틀 (예: Voting Screen) */
  subtitle?: string;
  roleLabel: string;
  showBack?: boolean;
  showViewResults?: boolean;
  onViewResults?: () => void;
  children: React.ReactNode;
};

export function VoteSessionChrome({
  forumTopic,
  forumSubtopic,
  subtitle = "Active forum discussion.",
  roleLabel,
  showBack = true,
  showViewResults = true,
  onViewResults,
  children,
}: Props) {
  const router = useRouter();

  return (
    <div className="flex min-h-screen flex-col bg-[#f1f5f9] text-slate-800">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-xs font-black text-white shadow-md shadow-brand/20">
            UN
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-brand">MUN Platform</p>
            <p className="truncate text-sm font-semibold text-gray-600">
              {forumTopic}
            </p>
            {forumSubtopic ? (
              <p className="truncate text-xs font-medium text-gray-500">{forumSubtopic}</p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-gray-600">
            {roleLabel}
          </span>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50"
          >
            <LogOut size={14} />
            Log Out
          </button>
        </div>
      </header>

      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-[#f8fafc] px-6 py-3">
        {showBack ? (
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 shadow-sm transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft size={14} />
            Back to Main
          </button>
        ) : (
          <div />
        )}
        {showViewResults && onViewResults && (
          <button
            type="button"
            onClick={onViewResults}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 shadow-sm transition-colors hover:border-brand/30 hover:text-brand"
          >
            View Results
            <ArrowRight size={14} />
          </button>
        )}
      </div>

      <section className="shrink-0 border-b border-gray-200 bg-white px-6 py-4 shadow-sm">
        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
          Current Agenda:{" "}
          <span className="font-semibold text-gray-600">{subtitle}</span>
        </p>
        <p className="mt-1 text-lg font-black text-gray-900 md:text-xl">
          Main Topic:{" "}
          <span className="text-brand">{forumTopic}</span>
        </p>
      </section>

      <main className="flex flex-1 flex-col p-5 md:p-6">{children}</main>
    </div>
  );
}
