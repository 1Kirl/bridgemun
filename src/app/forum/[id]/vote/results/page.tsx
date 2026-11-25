"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { useForumVotes, type VoteChoice } from "@/hooks/useForumVotes";
import {
  isForumVotingUnlocked,
  formatScheduledEndLocal,
} from "@/lib/forumSchedule";
import {
  getDefaultResolutionBody,
  getResolutionProtocolTitle,
} from "@/lib/resolutionDisplay";
import { VoteSessionChrome } from "@/components/forum/vote/VoteSessionChrome";
import { ArrowLeft, CheckCircle2, Scale } from "lucide-react";

type CountryEntry = { name: string; code: string };

type ForumData = {
  topic: string;
  subtopic?: string;
  countries?: CountryEntry[];
  status?: string;
  createdBy?: string;
  createdAt?: { toDate?: () => Date };
  time?: string;
  date?: string;
  ballotsFinalized?: boolean;
  resolutionText?: string;
};

type Participant = {
  userId: string;
  userName: string;
  country: CountryEntry;
};

function pct(part: number, whole: number) {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

const choiceLabel: Record<VoteChoice | "pending", string> = {
  yes: "YES",
  no: "NO",
  abstain: "ABSTAIN",
  pending: "—",
};

export default function ForumVoteResultsPage() {
  const params = useParams();
  const router = useRouter();
  const forumId =
    typeof params.id === "string"
      ? params.id
      : Array.isArray(params.id)
        ? params.id[0]
        : "";
  const { user } = useAuth();
  const { votes, tally } = useForumVotes(forumId);

  const [forum, setForum] = useState<ForumData | null>(null);
  const [forumLoaded, setForumLoaded] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);

  useEffect(() => {
    if (!forumId) return;
    return onSnapshot(
      doc(db, "forums", forumId),
      (snap) => {
        setForumLoaded(true);
        if (snap.exists()) setForum(snap.data() as ForumData);
        else setForum(null);
      },
      (err) => console.error("forum vote results: forum doc snapshot", err),
    );
  }, [forumId]);

  useEffect(() => {
    if (!forumId) return;
    const col = collection(db, "forums", forumId, "participants");
    return onSnapshot(
      col,
      (snap) => {
        setParticipants(
          snap.docs.map((d) => d.data() as Participant),
        );
      },
      (err) => console.error("forum vote results: participants snapshot", err),
    );
  }, [forumId]);

  const isModerator =
    !!user && !!forum?.createdBy && user.uid === forum.createdBy;
  const roleLabel = isModerator ? "Moderator" : "Participant";

  const voteByUser = useMemo(() => {
    const m = new Map<string, VoteChoice>();
    for (const v of votes) m.set(v.userId, v.choice);
    return m;
  }, [votes]);

  const { yes, no, abstain, cast } = tally;
  const decided = yes + no;
  const passed = decided > 0 && yes > no;
  const failed = decided > 0 && yes <= no;

  const resolutionTitle = useMemo(() => {
    if (!forum) return "";
    return getResolutionProtocolTitle(forum);
  }, [forum]);

  const resolutionBody = useMemo(() => {
    if (!forum) return "";
    const custom = forum.resolutionText?.trim();
    if (custom) return custom;
    return getDefaultResolutionBody(forum);
  }, [forum]);

  const coSponsors = useMemo(() => {
    const list = forum?.countries ?? [];
    if (list.length === 0) return "—";
    const names = list.slice(0, 6).map((c) => c.name);
    return names.join(", ") + (list.length > 6 ? ", …" : "");
  }, [forum?.countries]);

  const submittedBy = forum?.countries?.[0]?.name ?? "General Assembly";

  const rows = useMemo(() => {
    return participants.map((p) => {
      const c = voteByUser.get(p.userId);
      return {
        userId: p.userId,
        userName: p.userName,
        country: p.country,
        choice: c ?? ("pending" as const),
      };
    });
  }, [participants, voteByUser]);

  const yp = pct(yes, cast);
  const np = pct(no, cast);
  const ap = pct(abstain, cast);

  if (!forumLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f1f5f9] text-gray-400">
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#f1f5f9] px-6">
        <p className="text-gray-600">Sign in to view results.</p>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="rounded-lg bg-brand px-6 py-2 text-sm font-bold text-white"
        >
          Home
        </button>
      </div>
    );
  }

  if (!forum) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#f1f5f9] px-6">
        <p className="font-semibold text-gray-700">Forum not found.</p>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold"
        >
          Home
        </button>
      </div>
    );
  }

  if (forum.status === "closed" && !isForumVotingUnlocked(forum)) {
    const when = formatScheduledEndLocal(forum);
    return (
      <VoteSessionChrome
        forumTopic={forum.topic}
        forumSubtopic={forum.subtopic}
        subtitle="Voting has not opened yet."
        roleLabel={roleLabel}
        showViewResults={false}
      >
        <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-bold text-slate-800">
            Results are not available until the scheduled session end time.
          </p>
          {when ? (
            <p className="mt-3 text-sm text-slate-600">
              Opens after:{" "}
              <span className="font-bold text-slate-800">{when}</span>
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => router.push("/")}
            className="mt-6 rounded-xl bg-brand px-6 py-3 text-sm font-black uppercase tracking-wider text-white"
          >
            Home
          </button>
        </div>
      </VoteSessionChrome>
    );
  }

  return (
    <VoteSessionChrome
      forumTopic={forum.topic}
      forumSubtopic={forum.subtopic}
      subtitle="Voting results for the current resolution."
      roleLabel={roleLabel}
      showViewResults={false}
    >
      <div className="mx-auto w-full max-w-[900px] space-y-6">
        {!forum.ballotsFinalized && (
          <button
            type="button"
            onClick={() => router.push(`/forum/${forumId}/vote`)}
            className="flex items-center gap-2 text-xs font-bold text-brand hover:underline"
          >
            <ArrowLeft size={14} />
            Back to voting
          </button>
        )}

        <header className="space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
            Results
          </p>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 md:text-3xl">
            Voting outcome
          </h1>
          <p className="text-sm text-gray-500">
            Final tally and delegate positions for this resolution.
          </p>
        </header>

        <article className="rounded-2xl border-2 border-brand/25 bg-gradient-to-b from-brand/5 to-white p-6 shadow-md ring-1 ring-brand/10 md:p-7">
          <h2 className="text-base font-black leading-snug text-gray-900 md:text-lg">
            {resolutionTitle}
          </h2>
          <p className="mt-4 text-[14px] leading-relaxed text-gray-800 md:text-[15px]">
            {resolutionBody}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-[10px] font-bold text-gray-600">
              Submitted by: {submittedBy}
            </span>
            <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-[10px] font-bold text-gray-600">
              Co-sponsors: {coSponsors}
            </span>
          </div>
        </article>

        <section
          className={`rounded-2xl border p-6 shadow-sm md:p-8 ${
            passed
              ? "border-emerald-200 bg-emerald-50/80"
              : failed
                ? "border-slate-200 bg-slate-50"
                : "border-gray-200 bg-gray-50"
          }`}
          aria-label="Outcome summary"
        >
          {passed && (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                <CheckCircle2 size={28} strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-800/80">
                  Outcome
                </p>
                <p className="mt-1 text-xl font-black text-emerald-900 md:text-2xl">
                  Resolution adopted
                </p>
                <p className="mt-2 text-sm leading-relaxed text-emerald-900/85">
                  Yes votes exceed No votes under the current rule (more Yes than
                  No). Tally:{" "}
                  <span className="font-bold tabular-nums">
                    Yes {yes}, No {no}
                  </span>
                  {abstain > 0 ? (
                    <span className="font-bold tabular-nums">
                      , Abstain {abstain}
                    </span>
                  ) : null}
                  .
                </p>
              </div>
            </div>
          )}
          {failed && !passed && (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-200/80 text-slate-700">
                <Scale size={26} strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Outcome
                </p>
                <p className="mt-1 text-xl font-black text-slate-900 md:text-2xl">
                  Resolution not adopted
                </p>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  This is a normal voting result, not a system error. With the
                  current rule, the text is adopted only if{" "}
                  <span className="font-semibold text-slate-800">
                    Yes votes are strictly greater than No
                  </span>
                  . Your tally:{" "}
                  <span className="font-bold tabular-nums text-slate-800">
                    Yes {yes}, No {no}
                  </span>
                  {abstain > 0 ? (
                    <span className="font-bold tabular-nums text-slate-800">
                      , Abstain {abstain}
                    </span>
                  ) : null}
                  .
                </p>
              </div>
            </div>
          )}
          {!passed && !failed && (
            <p className="text-left text-sm font-semibold text-gray-600">
              No decisive Yes/No combination yet. Totals will appear here once
              delegates cast ballots.
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <h2 className="text-xs font-black uppercase tracking-[0.25em] text-gray-900">
            Aggregate tally
          </h2>
          <div className="mt-6 space-y-5">
            <ResultBar label="Yes (For)" count={yes} pct={yp} color="bg-brand" />
            <ResultBar label="No (Against)" count={no} pct={np} color="bg-sky-400" />
            <ResultBar
              label="Abstain"
              count={abstain}
              pct={ap}
              color="bg-slate-300"
            />
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 bg-gray-50/80 px-5 py-3">
            <h2 className="text-xs font-black uppercase tracking-[0.25em] text-gray-900">
              Country breakdown
            </h2>
            <p className="mt-0.5 text-[11px] text-gray-500">
              One row per delegate who joined this forum
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-[10px] font-black uppercase tracking-wider text-gray-400">
                  <th className="px-5 py-3">Country</th>
                  <th className="px-5 py-3">Delegate</th>
                  <th className="px-5 py-3">Vote</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-5 py-8 text-center text-gray-400"
                    >
                      No participants recorded for this session.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr
                      key={r.userId}
                      className="border-b border-gray-50 last:border-0"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <img
                            src={`https://flagcdn.com/w40/${r.country.code}.png`}
                            alt=""
                            className="h-4 w-6 rounded-sm border border-black/5 object-cover"
                          />
                          <span className="font-bold text-gray-800">
                            {r.country.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-gray-600">{r.userName}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                            r.choice === "yes"
                              ? "bg-emerald-100 text-emerald-800"
                              : r.choice === "no"
                                ? "bg-rose-100 text-rose-800"
                                : r.choice === "abstain"
                                  ? "bg-slate-100 text-slate-700"
                                  : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {choiceLabel[r.choice]}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="flex flex-wrap justify-center gap-3 pb-8">
          {!forum.ballotsFinalized && (
            <button
              type="button"
              onClick={() => router.push(`/forum/${forumId}/vote`)}
              className="rounded-xl border border-gray-200 bg-white px-6 py-3 text-sm font-black uppercase tracking-wider text-gray-700 shadow-sm hover:border-brand/30"
            >
              Return to voting
            </button>
          )}
          <button
            type="button"
            onClick={() => router.push("/")}
            className="rounded-xl bg-brand px-6 py-3 text-sm font-black uppercase tracking-wider text-white shadow-lg shadow-brand/25 hover:bg-brand-hover"
          >
            Main dashboard
          </button>
        </div>
      </div>
    </VoteSessionChrome>
  );
}

function ResultBar({
  label,
  count,
  pct: p,
  color,
}: {
  label: string;
  count: number;
  pct: number;
  color: string;
}) {
  return (
    <div>
      <div className="mb-2 flex justify-between text-sm font-bold text-gray-800">
        <span>{label}</span>
        <span>
          {count} votes ({p.toFixed(1)}%)
        </span>
      </div>
      <div className="h-4 overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${Math.min(100, p)}%` }}
        />
      </div>
    </div>
  );
}
