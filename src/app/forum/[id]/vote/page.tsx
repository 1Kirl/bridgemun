"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { authedFetch } from "@/lib/authedFetch";
import { useAuth } from "@/context/AuthContext";
import { useForumVotes, type VoteChoice } from "@/hooks/useForumVotes";
import { useForumSpeeches } from "@/hooks/useForumSpeeches";
import {
  isForumVotingUnlocked,
  formatScheduledEndLocal,
} from "@/lib/forumSchedule";
import {
  getDefaultResolutionBody,
  getResolutionProtocolTitle,
} from "@/lib/resolutionDisplay";
import { VoteSessionChrome } from "@/components/forum/vote/VoteSessionChrome";
import { ThumbsUp, ThumbsDown, CircleDot, Sparkles, Loader2 } from "lucide-react";
import { useModal } from "@/context/ModalContext";

type CountryEntry = { name: string; code: string; isAI?: boolean };

type ForumData = {
  topic: string;
  subtopic?: string;
  countries?: CountryEntry[];
  status?: string;
  createdBy?: string;
  createdAt?: { toDate?: () => Date };
  time?: string;
  date?: string;
  votingOpen?: boolean;
  ballotsFinalized?: boolean;
  resolutionText?: string;
  resolutionSource?: string;
  forumDiscussionSummary?: string;
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

function votingWindowOpen(forum: ForumData): boolean {
  const live = forum.status === "active" && forum.votingOpen === true;
  const post = forum.status === "closed" && isForumVotingUnlocked(forum);
  return live || post;
}

export default function ForumVotePage() {
  const params = useParams();
  const router = useRouter();
  const forumId =
    typeof params.id === "string"
      ? params.id
      : Array.isArray(params.id)
        ? params.id[0]
        : "";
  const { user } = useAuth();
  const { showAlert, showConfirm } = useModal();
  const { votes, tally, castVote } = useForumVotes(forumId);
  const { speeches, loading: speechesLoading } = useForumSpeeches(forumId);

  const [forum, setForum] = useState<ForumData | null>(null);
  const [forumLoaded, setForumLoaded] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [resolutionDraft, setResolutionDraft] = useState("");
  const [savingRes, setSavingRes] = useState(false);
  const [aiResBusy, setAiResBusy] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false);

  useEffect(() => {
    if (!forumId) return;
    return onSnapshot(
      doc(db, "forums", forumId),
      (snap) => {
        setForumLoaded(true);
        if (snap.exists()) setForum(snap.data() as ForumData);
        else setForum(null);
      },
      (err) => console.error("forum vote: forum doc snapshot", err),
    );
  }, [forumId]);

  useEffect(() => {
    if (!forumId) return;
    const col = collection(db, "forums", forumId, "participants");
    return onSnapshot(
      col,
      (snap) => {
        setParticipants(snap.docs.map((d) => d.data() as Participant));
      },
      (err) => console.error("forum vote: participants snapshot", err),
    );
  }, [forumId]);

  useEffect(() => {
    if (forum?.resolutionText != null) {
      setResolutionDraft(forum.resolutionText);
    }
  }, [forum?.resolutionText]);

  const me = participants.find((p) => p.userId === user?.uid);
  const isModerator =
    !!user && !!forum?.createdBy && user.uid === forum.createdBy;

  const myVote = votes.find((v) => v.userId === user?.uid);
  const roleLabel = isModerator ? "Moderator" : "Participant";

  const resolutionTitle = useMemo(() => {
    if (!forum) return "";
    return getResolutionProtocolTitle(forum);
  }, [forum]);

  const resolutionDisplayBody = useMemo(() => {
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

  const canVote =
    !!user &&
    !!forum &&
    !forum.ballotsFinalized &&
    !isModerator &&
    !!me &&
    votingWindowOpen(forum);

  const saveResolution = async () => {
    if (!forumId || !isModerator) return;
    setSavingRes(true);
    try {
      await updateDoc(doc(db, "forums", forumId), {
        resolutionText: resolutionDraft.trim(),
        resolutionSource: "moderator",
      });
      await showAlert("Resolution saved.", "Saved");
    } catch (e) {
      await showAlert(String(e), "Save failed");
    } finally {
      setSavingRes(false);
    }
  };

  const generateAiResolution = async () => {
    if (!forum) return;
    setAiResBusy(true);
    try {
      const res = await authedFetch("/api/ai/resolution-draft", {
        method: "POST",
        body: JSON.stringify({
          forumId,
          topic: forum.topic,
          subtopic: forum.subtopic,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      const text = typeof data.text === "string" ? data.text : "";
      setResolutionDraft(text);
      await updateDoc(doc(db, "forums", forumId), {
        resolutionText: text,
        resolutionSource: "ai",
      });
    } catch (e) {
      await showAlert(String(e), "AI draft");
    } finally {
      setAiResBusy(false);
    }
  };

  const generateForumSummary = async () => {
    if (!forum) return;
    setSummaryBusy(true);
    try {
      const lines = speeches.map((s) => ({
        speaker: [s.countryName, s.userName].filter(Boolean).join(" · ") || s.userName,
        text: s.text,
      }));
      const res = await authedFetch("/api/ai/forum-summary", {
        method: "POST",
        body: JSON.stringify({ forumId, topic: forum.topic, lines }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Summary failed");
      const summary = data.summary as string;
      await updateDoc(doc(db, "forums", forumId), {
        forumDiscussionSummary: summary,
      });
    } catch (e) {
      await showAlert(String(e), "Summary");
    } finally {
      setSummaryBusy(false);
    }
  };

  const finalizeBallots = async () => {
    const ok = await showConfirm(
      "Finalize ballots? Delegates will no longer be able to change votes.",
      "Finalize voting",
    );
    if (!ok) return;
    try {
      await updateDoc(doc(db, "forums", forumId), { ballotsFinalized: true });
      await showAlert("Ballots are now closed.", "Done");
    } catch (e) {
      await showAlert(String(e), "Error");
    }
  };

  const onCast = async (choice: VoteChoice) => {
    if (!user || !canVote) return;
    setSubmitting(true);
    try {
      const country = me?.country ?? {
        name: "Moderator Chair",
        code: "un",
      };
      await castVote({
        userId: user.uid,
        userName: user.displayName || user.email || "Anonymous",
        countryCode: country.code,
        countryName: country.name,
        choice,
      });
    } catch (e) {
      await showAlert(`Could not submit vote: ${String(e)}`, "Vote Error");
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#f1f5f9] px-6">
        <p className="text-center text-gray-600">Sign in to access voting.</p>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="rounded-lg bg-brand px-6 py-2 text-sm font-bold text-white"
        >
          Go to Home
        </button>
      </div>
    );
  }

  if (!forumLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f1f5f9] text-gray-400">
        Loading…
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

  if (forum.ballotsFinalized) {
    return (
      <VoteSessionChrome
        forumTopic={forum.topic}
        forumSubtopic={forum.subtopic}
        subtitle="Voting is closed."
        roleLabel={roleLabel}
        showViewResults={true}
        onViewResults={() => router.push(`/forum/${forumId}/vote/results`)}
      >
        <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-bold text-slate-800">
            Ballots have been finalized. No further changes are allowed.
          </p>
          <button
            type="button"
            onClick={() => router.push(`/forum/${forumId}/vote/results`)}
            className="mt-6 rounded-xl bg-brand px-6 py-3 text-sm font-black uppercase tracking-wider text-white"
          >
            View results
          </button>
        </div>
      </VoteSessionChrome>
    );
  }

  if (forum.status === "active" && !forum.votingOpen) {
    return (
      <VoteSessionChrome
        forumTopic={forum.topic}
        forumSubtopic={forum.subtopic}
        roleLabel={roleLabel}
        showViewResults={false}
      >
        <div className="mx-auto max-w-lg rounded-2xl border border-amber-200 bg-amber-50/80 p-8 text-center shadow-sm">
          <p className="text-sm font-bold text-amber-900">
            The chair has not opened floor voting yet. You can still join the
            live forum.
          </p>
          <button
            type="button"
            onClick={() => router.push(`/forum/${forumId}`)}
            className="mt-6 rounded-xl bg-brand px-6 py-3 text-sm font-black uppercase tracking-wider text-white"
          >
            Return to live forum
          </button>
        </div>
      </VoteSessionChrome>
    );
  }

  if (forum.status === "closed" && !isForumVotingUnlocked(forum)) {
    const when = formatScheduledEndLocal(forum);
    return (
      <VoteSessionChrome
        forumTopic={forum.topic}
        forumSubtopic={forum.subtopic}
        roleLabel={roleLabel}
        showViewResults={false}
      >
        <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-bold text-slate-800">
            Voting is not open yet. The session ended before the scheduled finish
            time.
          </p>
          {when ? (
            <p className="mt-3 text-sm text-slate-600">
              Ballots open after:{" "}
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

  if (!isModerator && !me) {
    return (
      <VoteSessionChrome
        forumTopic={forum.topic}
        forumSubtopic={forum.subtopic}
        roleLabel="Guest"
        showViewResults={true}
        onViewResults={() => router.push(`/forum/${forumId}/vote/results`)}
      >
        <p className="text-center text-sm text-gray-600">
          Only delegates who joined this forum may cast a ballot. You can still
          view results.
        </p>
      </VoteSessionChrome>
    );
  }

  const { yes, no, abstain, cast } = tally;
  const yp = pct(yes, cast);
  const np = pct(no, cast);
  const ap = pct(abstain, cast);

  return (
    <VoteSessionChrome
      forumTopic={forum.topic}
      forumSubtopic={forum.subtopic}
      subtitle="Cast your vote on the current resolution."
      roleLabel={roleLabel}
      showViewResults={true}
      onViewResults={() => router.push(`/forum/${forumId}/vote/results`)}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4">
        {isModerator && (
          <section className="rounded-2xl border border-brand/25 bg-brand/5 p-4 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand">
              Chair — resolution text
            </p>
            <textarea
              value={resolutionDraft}
              onChange={(e) => setResolutionDraft(e.target.value)}
              rows={5}
              className="mt-2 w-full resize-y rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
              placeholder="Draft the operative resolution delegates will vote on…"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={savingRes}
                onClick={() => void saveResolution()}
                className="rounded-lg bg-brand px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white hover:bg-brand-hover disabled:opacity-50"
              >
                {savingRes ? "Saving…" : "Save resolution"}
              </button>
              <button
                type="button"
                disabled={aiResBusy}
                onClick={() => void generateAiResolution()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-purple-300 bg-purple-50 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-purple-800 hover:bg-purple-600 hover:text-white disabled:opacity-50"
              >
                {aiResBusy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                AI draft
              </button>
              <button
                type="button"
                onClick={() => void finalizeBallots()}
                className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-red-700 hover:bg-red-600 hover:text-white"
              >
                Finalize ballots
              </button>
            </div>
          </section>
        )}

        <article className="rounded-2xl border-2 border-brand/30 bg-gradient-to-b from-brand/5 to-white p-6 shadow-md ring-1 ring-brand/10">
          <h2 className="text-base font-black leading-snug text-gray-900 md:text-lg">
            {resolutionTitle}
          </h2>
          <p className="mt-4 text-[14px] leading-relaxed text-gray-800 md:text-[15px]">
            {resolutionDisplayBody}
          </p>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-brand/10 pt-4">
            <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[10px] font-bold text-gray-600">
              Submitted by: {submittedBy}
            </span>
            <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[10px] font-bold text-gray-600">
              Co-sponsors: {coSponsors}
            </span>
            {forum.resolutionSource ? (
              <span className="rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-[10px] font-bold text-purple-800">
                Source: {forum.resolutionSource === "ai" ? "AI draft" : "Chair"}
              </span>
            ) : null}
          </div>
        </article>

        {forum.forumDiscussionSummary ? (
          <article className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5 shadow-sm">
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-700">
              Forum discussion summary
            </h3>
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-800">
              {forum.forumDiscussionSummary}
            </p>
          </article>
        ) : (
          isModerator && (
            <article className="rounded-2xl border border-dashed border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">
                Forum discussion summary
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                {speechesLoading
                  ? "Loading discussion…"
                  : speeches.length === 0
                    ? "No speeches in the feed yet."
                    : `${speeches.length} message(s) — generate an AI summary for delegates.`}
              </p>
              <button
                type="button"
                disabled={summaryBusy || speeches.length === 0}
                onClick={() => void generateForumSummary()}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-slate-700 hover:bg-slate-800 hover:text-white disabled:opacity-50"
              >
                {summaryBusy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                Generate summary
              </button>
            </article>
          )
        )}

        <article className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">
            Cast Your Vote
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            {isModerator
              ? "The chair does not cast a national ballot."
              : "Select your country's position on this resolution"}
          </p>
          {!isModerator && myVote && (
            <p className="mt-2 text-[11px] font-bold text-brand">
              Your current vote:{" "}
              <span className="uppercase">{myVote.choice}</span>
              {forum.ballotsFinalized
                ? ""
                : " — you may change it until ballots are finalized."}
            </p>
          )}
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              type="button"
              disabled={!canVote || submitting || isModerator}
              onClick={() => onCast("yes")}
              className="flex items-center justify-center gap-2 rounded-xl border-2 border-emerald-200 bg-emerald-50 py-4 text-sm font-black uppercase tracking-wide text-emerald-800 transition hover:bg-emerald-600 hover:text-white disabled:opacity-40"
            >
              <ThumbsUp size={18} />
              Yes (For)
            </button>
            <button
              type="button"
              disabled={!canVote || submitting || isModerator}
              onClick={() => onCast("no")}
              className="flex items-center justify-center gap-2 rounded-xl border-2 border-rose-200 bg-rose-50 py-4 text-sm font-black uppercase tracking-wide text-rose-800 transition hover:bg-rose-600 hover:text-white disabled:opacity-40"
            >
              <ThumbsDown size={18} />
              No (Against)
            </button>
            <button
              type="button"
              disabled={!canVote || submitting || isModerator}
              onClick={() => onCast("abstain")}
              className="flex items-center justify-center gap-2 rounded-xl border-2 border-slate-200 bg-slate-50 py-4 text-sm font-black uppercase tracking-wide text-slate-700 transition hover:bg-slate-600 hover:text-white disabled:opacity-40"
            >
              <CircleDot size={18} />
              Abstain
            </button>
          </div>
        </article>

        <article className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">
            Live Vote Tally
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            Real-time voting results from all participants
          </p>
          <div className="mt-4 space-y-4">
            <TallyRow label="Yes (For)" count={yes} pct={yp} barClass="bg-brand" />
            <TallyRow
              label="No (Against)"
              count={no}
              pct={np}
              barClass="bg-sky-400"
            />
            <TallyRow
              label="Abstain"
              count={abstain}
              pct={ap}
              barClass="bg-slate-300"
            />
          </div>
        </article>

        <p className="flex items-start gap-2 text-[10px] leading-relaxed text-gray-400">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-brand/70" />
          <span>
            National positions are recorded when each delegate submits a ballot.
            Totals update live for the chair and the floor.
          </span>
        </p>
      </div>
    </VoteSessionChrome>
  );
}

function TallyRow({
  label,
  count,
  pct: p,
  barClass,
}: {
  label: string;
  count: number;
  pct: number;
  barClass: string;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] font-bold text-gray-700">
        <span>{label}</span>
        <span>
          {count} ({p.toFixed(1)}%)
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barClass}`}
          style={{ width: `${Math.min(100, p)}%` }}
        />
      </div>
    </div>
  );
}
