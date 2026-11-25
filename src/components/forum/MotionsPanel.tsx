'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Vote, Plus, X, Lock, Trash2, Check } from 'lucide-react';

type Motion = {
  id: string;
  title: string;
  options: string[];
  status: 'open' | 'closed';
};

type Ballot = { id: string; option: string };

type Props = {
  forumId: string;
  isModerator: boolean;
  userId: string;
  userName: string;
};

/**
 * 모더레이터가 토론 중 투표(안건)를 직접 만들고, 참가자가 투표하는 범용 투표 기능. (QA2 #1)
 * 기존 "결의안 찬반"(useForumVotes)과 별개로, 여러 안건을 자유롭게 생성/개표/마감한다.
 * forums/{forumId}/motions/{motionId} + 하위 ballots/{userId} 구조.
 */
export function MotionsPanel({ forumId, isModerator, userId, userName }: Props) {
  const [motions, setMotions] = useState<Motion[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [optionsText, setOptionsText] = useState('Yes\nNo\nAbstain');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!forumId) return;
    const q = query(
      collection(db, 'forums', forumId, 'motions'),
      orderBy('createdAt', 'asc'),
    );
    return onSnapshot(
      q,
      (snap) => {
        setMotions(
          snap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              title: typeof data.title === 'string' ? data.title : '',
              options: Array.isArray(data.options)
                ? (data.options as string[])
                : [],
              status: data.status === 'closed' ? 'closed' : 'open',
            };
          }),
        );
      },
      (err) => console.error('motions snapshot', err),
    );
  }, [forumId]);

  const createMotion = async () => {
    const t = title.trim();
    const options = optionsText
      .split('\n')
      .map((o) => o.trim())
      .filter(Boolean);
    if (!t || options.length < 2) return;
    setBusy(true);
    try {
      await addDoc(collection(db, 'forums', forumId, 'motions'), {
        title: t,
        options,
        status: 'open',
        createdBy: userId,
        createdAt: serverTimestamp(),
      });
      setTitle('');
      setOptionsText('Yes\nNo\nAbstain');
      setCreating(false);
    } catch (e) {
      console.error('create motion', e);
    } finally {
      setBusy(false);
    }
  };

  if (!isModerator && motions.length === 0) {
    // 참가자에게는 안건이 없을 때 패널을 숨겨 화면을 비우지 않는다.
    return null;
  }

  return (
    <div className="shrink-0 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Vote size={16} className="text-brand" />
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-900">
            Motions &amp; Votes
          </h3>
        </div>
        {isModerator && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-white hover:bg-brand-hover"
          >
            <Plus size={12} />
            New vote
          </button>
        )}
      </div>

      {/* 모더레이터: 새 투표 생성 폼 */}
      {isModerator && creating && (
        <div className="mt-3 space-y-2 rounded-xl border border-brand/20 bg-brand/5 p-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Motion / question (e.g. Adopt the draft resolution?)"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-gray-500">
              Options (one per line)
            </label>
            <textarea
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              rows={3}
              className="mt-1 w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setTitle('');
                setOptionsText('Yes\nNo\nAbstain');
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-[10px] font-bold text-gray-600 hover:bg-gray-50"
            >
              <X size={12} />
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void createMotion()}
              className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white hover:bg-brand-hover disabled:opacity-50"
            >
              <Check size={12} />
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* 안건 목록 */}
      <div className="mt-3 space-y-3">
        {motions.length === 0 ? (
          <p className="text-xs text-gray-400">
            No votes yet. Create one to put a question to the floor.
          </p>
        ) : (
          motions.map((m) => (
            <MotionCard
              key={m.id}
              forumId={forumId}
              motion={m}
              isModerator={isModerator}
              userId={userId}
              userName={userName}
            />
          ))
        )}
      </div>
    </div>
  );
}

function MotionCard({
  forumId,
  motion,
  isModerator,
  userId,
  userName,
}: {
  forumId: string;
  motion: Motion;
  isModerator: boolean;
  userId: string;
  userName: string;
}) {
  const [ballots, setBallots] = useState<Ballot[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const col = collection(
      db,
      'forums',
      forumId,
      'motions',
      motion.id,
      'ballots',
    );
    return onSnapshot(
      col,
      (snap) => {
        setBallots(
          snap.docs.map((d) => ({
            id: d.id,
            option: (d.data().option as string) ?? '',
          })),
        );
      },
      (err) => console.error('ballots snapshot', err),
    );
  }, [forumId, motion.id]);

  const tally = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of motion.options) counts[o] = 0;
    for (const b of ballots) {
      if (b.option in counts) counts[b.option] += 1;
    }
    return counts;
  }, [ballots, motion.options]);

  const total = ballots.length;
  const myChoice = ballots.find((b) => b.id === userId)?.option;
  const isOpen = motion.status === 'open';
  const canVote = !isModerator && isOpen;

  const cast = async (option: string) => {
    if (!canVote) return;
    setSubmitting(true);
    try {
      await setDoc(
        doc(db, 'forums', forumId, 'motions', motion.id, 'ballots', userId),
        {
          userId,
          userName,
          option,
          updatedAt: serverTimestamp(),
          ...(myChoice == null ? { createdAt: serverTimestamp() } : {}),
        },
        { merge: true },
      );
    } catch (e) {
      console.error('cast motion ballot', e);
    } finally {
      setSubmitting(false);
    }
  };

  const setStatus = async (status: 'open' | 'closed') => {
    try {
      await updateDoc(
        doc(db, 'forums', forumId, 'motions', motion.id),
        { status },
      );
    } catch (e) {
      console.error('update motion status', e);
    }
  };

  const remove = async () => {
    try {
      await deleteDoc(doc(db, 'forums', forumId, 'motions', motion.id));
    } catch (e) {
      console.error('delete motion', e);
    }
  };

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-bold text-gray-900">{motion.title}</p>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
            isOpen
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-slate-200 text-slate-600'
          }`}
        >
          {isOpen ? 'Open' : 'Closed'}
        </span>
      </div>

      <div className="mt-2 space-y-1.5">
        {motion.options.map((o) => {
          const count = tally[o] ?? 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          const mine = myChoice === o;
          return (
            <div key={o}>
              <button
                type="button"
                disabled={!canVote || submitting}
                onClick={() => void cast(o)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left text-xs font-bold transition ${
                  mine
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-gray-200 bg-white text-gray-700'
                } ${canVote ? 'hover:border-brand/40' : 'cursor-default'} disabled:opacity-100`}
              >
                <span className="flex items-center gap-1.5 truncate">
                  {mine && <Check size={12} className="shrink-0" />}
                  {o}
                </span>
                <span className="shrink-0 text-[11px] text-gray-500">
                  {count} ({pct}%)
                </span>
              </button>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-brand transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] font-medium text-gray-400">
          {total} ballot{total === 1 ? '' : 's'}
        </span>
        {isModerator && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void setStatus(isOpen ? 'closed' : 'open')}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[9px] font-black uppercase tracking-wider text-gray-600 hover:bg-gray-50"
            >
              <Lock size={10} />
              {isOpen ? 'Close' : 'Reopen'}
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1 text-[9px] font-black uppercase tracking-wider text-red-600 hover:bg-red-50"
            >
              <Trash2 size={10} />
              Delete
            </button>
          </div>
        )}
      </div>

      {!isModerator && !isOpen && (
        <p className="mt-2 text-[10px] font-medium text-slate-400">
          This vote is closed.
        </p>
      )}
    </div>
  );
}
