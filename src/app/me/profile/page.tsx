"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { updateProfile } from "firebase/auth";
import {
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { ArrowLeft, Loader2, MessageSquare, Vote } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { LoginModal } from "@/components/landing/LoginModal";
import { RegisterModal } from "@/components/landing/RegisterModal";
import { Button } from "@/components/ui/Button";

type DebateRow = {
  id: string;
  forumId: string;
  topic: string;
  text: string;
  countryName?: string;
  time: number;
};

type BallotRow = {
  forumId: string;
  topic: string;
  choice: string;
  countryName?: string;
  time: number;
};

function formatDate(time: number): string {
  if (!time) return "";
  return new Date(time).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [debates, setDebates] = useState<DebateRow[]>([]);
  const [ballots, setBallots] = useState<BallotRow[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  const [histError, setHistError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName ?? "");
    }
  }, [user]);

  // 내 이전 debate(발언) 내역 + 투표 기록 로드 (QA2 #3)
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setDebates([]);
      setBallots([]);
      setHistLoading(false);
      setHistError(null);
      return;
    }

    let cancelled = false;
    setHistLoading(true);
    setHistError(null);

    (async () => {
      try {
        await auth.authStateReady();
        await user.getIdToken(true);

        const topicCache = new Map<string, string>();
        const topicOf = async (fid: string): Promise<string> => {
          const cached = topicCache.get(fid);
          if (cached) return cached;
          const fs = await getDoc(doc(db, "forums", fid));
          const t =
            fs.exists() && typeof fs.data().topic === "string"
              ? (fs.data().topic as string)
              : "Untitled forum";
          topicCache.set(fid, t);
          return t;
        };

        const millis = (v: unknown): number => {
          const x = v as { toMillis?: () => number } | undefined;
          return typeof x?.toMillis === "function" ? x.toMillis() : 0;
        };

        // 발언(speeches): 사람 발언은 userId === uid (AI 발언은 "ai:코드")
        const sSnap = await getDocs(
          query(collectionGroup(db, "speeches"), where("userId", "==", user.uid)),
        );
        const dRows: DebateRow[] = [];
        for (const d of sSnap.docs) {
          const fid = d.ref.parent.parent?.id;
          if (!fid) continue;
          const data = d.data() as Record<string, unknown>;
          dRows.push({
            id: d.id,
            forumId: fid,
            topic: await topicOf(fid),
            text: typeof data.text === "string" ? data.text : "",
            countryName:
              typeof data.countryName === "string" ? data.countryName : undefined,
            time: millis(data.createdAt),
          });
        }
        dRows.sort((a, b) => b.time - a.time);

        // 투표(votes): 문서 id가 userId
        const vSnap = await getDocs(
          query(collectionGroup(db, "votes"), where("userId", "==", user.uid)),
        );
        const bRows: BallotRow[] = [];
        for (const d of vSnap.docs) {
          const fid = d.ref.parent.parent?.id;
          if (!fid) continue;
          const data = d.data() as Record<string, unknown>;
          bRows.push({
            forumId: fid,
            topic: await topicOf(fid),
            choice: typeof data.choice === "string" ? data.choice : "",
            countryName:
              typeof data.countryName === "string" ? data.countryName : undefined,
            time: millis(data.updatedAt) || millis(data.createdAt),
          });
        }
        bRows.sort((a, b) => b.time - a.time);

        if (!cancelled) {
          setDebates(dRows);
          setBallots(bRows);
        }
      } catch (e) {
        const msg = String(e);
        if (!cancelled) {
          if (msg.includes("permission-denied")) {
            setHistError(
              "Firestore permission denied. Publish the latest firestore.rules, then refresh.",
            );
          } else if (msg.includes("index") || msg.includes("failed-precondition")) {
            setHistError(
              "Firestore index required for history. Open the index link from the browser console, then refresh.",
            );
          } else {
            setHistError(msg);
          }
        }
      } finally {
        if (!cancelled) setHistLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const handleSave = async () => {
    const u = auth.currentUser;
    if (!u) return;
    const name = displayName.trim();
    setSaving(true);
    setMessage(null);
    try {
      await updateProfile(u, { displayName: name || undefined });
      await setDoc(
        doc(db, "users", u.uid),
        {
          displayName: name || u.displayName || "Anonymous",
          email: u.email,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setMessage("Profile updated.");
    } catch (e) {
      setMessage(`Could not save: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#f8fafc]">
      <Header
        onLoginClick={() => {
          setRegisterOpen(false);
          setLoginOpen(true);
        }}
      />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pb-16 pt-24">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-bold text-brand hover:underline"
        >
          <ArrowLeft size={16} />
          Main page
        </Link>

        <h1 className="text-2xl font-black tracking-tight text-gray-900">
          Profile
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Update how your name appears in forums. Email is tied to your login
          account.
        </p>

        {!authLoading && !user && (
          <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm font-semibold text-gray-700">
              Sign in to edit your profile.
            </p>
            <button
              type="button"
              onClick={() => setLoginOpen(true)}
              className="mt-4 rounded-xl bg-brand px-6 py-2.5 text-sm font-black uppercase tracking-wider text-white"
            >
              Log in
            </button>
          </div>
        )}

        {user && (
          <div className="mt-8 space-y-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="text-xs font-black uppercase tracking-wider text-gray-400"
              >
                Email
              </label>
              <p id="email" className="text-sm font-medium text-gray-800">
                {user.email ?? "—"}
              </p>
              <p className="text-xs text-gray-500">
                Changing email is not supported here; use account recovery or
                contact your administrator if needed.
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="displayName"
                className="text-xs font-black uppercase tracking-wider text-gray-400"
              >
                Display name
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name in sessions"
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
            </div>

            {message && (
              <p
                className={`text-sm font-medium ${
                  message.startsWith("Could not") ? "text-red-600" : "text-emerald-600"
                }`}
              >
                {message}
              </p>
            )}

            <Button
              type="button"
              className="w-full bg-brand hover:bg-brand-hover"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Saving…
                </span>
              ) : (
                "Save changes"
              )}
            </Button>

            <Link
              href="/me"
              className="block text-center text-sm font-bold text-brand hover:underline"
            >
              My forums
            </Link>
          </div>
        )}

        {user && (
          <div className="mt-6 space-y-6">
            {histError && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">
                {histError}
              </div>
            )}

            {/* 이전 debate(발언) 내역 */}
            <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <MessageSquare size={16} className="text-brand" />
                <h2 className="text-xs font-black uppercase tracking-wider text-gray-900">
                  Debate history
                </h2>
                {!histLoading && (
                  <span className="text-xs font-bold text-gray-400">
                    {debates.length}
                  </span>
                )}
              </div>

              {histLoading ? (
                <p className="mt-3 text-sm text-gray-500">Loading…</p>
              ) : debates.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">
                  You haven&apos;t spoken in any forum yet.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {debates.map((d) => (
                    <li
                      key={`${d.forumId}-${d.id}`}
                      className="rounded-xl border border-gray-100 bg-gray-50/60 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Link
                          href={`/forum/${d.forumId}/vote/results`}
                          className="truncate text-sm font-bold text-gray-900 hover:text-brand hover:underline"
                        >
                          {d.topic}
                        </Link>
                        <span className="shrink-0 text-[11px] font-medium text-gray-400">
                          {formatDate(d.time)}
                        </span>
                      </div>
                      {d.countryName && (
                        <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-brand">
                          {d.countryName}
                        </p>
                      )}
                      <p className="mt-1 line-clamp-3 text-sm text-gray-700">
                        {d.text}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* 투표 기록 */}
            <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <Vote size={16} className="text-brand" />
                <h2 className="text-xs font-black uppercase tracking-wider text-gray-900">
                  Voting history
                </h2>
                {!histLoading && (
                  <span className="text-xs font-bold text-gray-400">
                    {ballots.length}
                  </span>
                )}
              </div>

              {histLoading ? (
                <p className="mt-3 text-sm text-gray-500">Loading…</p>
              ) : ballots.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">
                  You haven&apos;t cast a ballot yet.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {ballots.map((b) => (
                    <li
                      key={b.forumId}
                      className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/forum/${b.forumId}/vote/results`}
                          className="block truncate text-sm font-bold text-gray-900 hover:text-brand hover:underline"
                        >
                          {b.topic}
                        </Link>
                        <p className="text-[11px] font-medium text-gray-400">
                          {b.countryName ? `${b.countryName} · ` : ""}
                          {formatDate(b.time)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider ${
                          b.choice === "yes"
                            ? "bg-emerald-100 text-emerald-800"
                            : b.choice === "no"
                              ? "bg-rose-100 text-rose-800"
                              : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {b.choice || "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>

      <Footer />

      <LoginModal
        isOpen={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSwitchToRegister={() => {
          setLoginOpen(false);
          setRegisterOpen(true);
        }}
      />
      <RegisterModal
        isOpen={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onSwitchToLogin={() => {
          setRegisterOpen(false);
          setLoginOpen(true);
        }}
      />
    </div>
  );
}
