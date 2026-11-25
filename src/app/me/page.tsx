"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { LoginModal } from "@/components/landing/LoginModal";
import { RegisterModal } from "@/components/landing/RegisterModal";
import { ScrollText, ChevronRight } from "lucide-react";

type ForumRole = "delegate" | "moderator";

type MyForumRow = {
  id: string;
  topic: string;
  status: string;
  date?: string;
  roles: ForumRole[];
  sortTime: number;
};

export default function MyForumsPage() {
  const { user, loading: authLoading } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [rows, setRows] = useState<MyForumRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        await auth.authStateReady();
        await user.getIdToken(true);

        const forumIds = new Set<string>();
        const roles = new Map<string, Set<ForumRole>>();

        const partQ = query(
          collectionGroup(db, "participants"),
          where("userId", "==", user.uid),
        );
        const partSnap = await getDocs(partQ);
        partSnap.forEach((d) => {
          const parent = d.ref.parent;
          const forumRef = parent.parent;
          const fid = forumRef?.id;
          if (!fid) return;
          forumIds.add(fid);
          if (!roles.has(fid)) roles.set(fid, new Set());
          roles.get(fid)!.add("delegate");
        });

        const modQ = query(
          collection(db, "forums"),
          where("createdBy", "==", user.uid),
        );
        const modSnap = await getDocs(modQ);
        modSnap.forEach((d) => {
          forumIds.add(d.id);
          if (!roles.has(d.id)) roles.set(d.id, new Set());
          roles.get(d.id)!.add("moderator");
        });

        const next: MyForumRow[] = [];
        for (const fid of forumIds) {
          const fsnap = await getDoc(doc(db, "forums", fid));
          if (!fsnap.exists()) continue;
          const data = fsnap.data() as Record<string, unknown>;
          const createdAt = data.createdAt as { toMillis?: () => number } | undefined;
          const sortTime =
            typeof createdAt?.toMillis === "function" ? createdAt.toMillis() : 0;
          next.push({
            id: fid,
            topic: typeof data.topic === "string" ? data.topic : "Untitled forum",
            status: typeof data.status === "string" ? data.status : "active",
            date: typeof data.date === "string" ? data.date : undefined,
            roles: Array.from(roles.get(fid) ?? []),
            sortTime,
          });
        }

        next.sort((a, b) => b.sortTime - a.sortTime);
        if (!cancelled) setRows(next);
      } catch (e) {
        const msg = String(e);
        if (!cancelled) {
          if (msg.includes("permission-denied")) {
            setError(
              "Firestore permission denied. Publish the latest firestore.rules from this project (Firebase Console → Firestore → Rules → Publish), then refresh. If it persists, sign out and sign in again.",
            );
          } else if (msg.includes("index") || msg.includes("failed-precondition")) {
            setError(
              "Firestore index required for “My forums”. Add the participants / userId collection-group exception, or use the index link from the browser console.",
            );
          } else {
            setError(msg);
          }
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  return (
    <div className="flex min-h-screen flex-col bg-[#f8fafc]">
      <Header
        onLoginClick={() => {
          setRegisterOpen(false);
          setLoginOpen(true);
        }}
      />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 pb-16 pt-24">
        <div className="mb-8 flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <ScrollText size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-gray-900">
              My forums
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              Forums you joined as a delegate or moderated. Open voting results
              without re-entering the live session.
            </p>
          </div>
        </div>

        {!user && (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm font-semibold text-gray-700">
              Sign in to see forums you participated in.
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

        {user && loading && (
          <p className="text-sm font-medium text-gray-500">Loading your forums…</p>
        )}

        {user && error && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">
            {error}
          </div>
        )}

        {user && !loading && !error && rows.length === 0 && (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm text-gray-600">
              No forums yet. Join a session from the home page, or create one as
              moderator.
            </p>
            <Link
              href="/"
              className="mt-4 inline-block text-sm font-bold text-brand hover:underline"
            >
              Back to home
            </Link>
          </div>
        )}

        {user && !loading && rows.length > 0 && (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li
                key={r.id}
                className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">
                      {r.date ? `Scheduled ${r.date}` : "Forum"}{" "}
                      <span className="text-gray-300">·</span>{" "}
                      <span
                        className={
                          r.status === "closed"
                            ? "text-slate-500"
                            : "text-emerald-600"
                        }
                      >
                        {r.status === "closed" ? "Closed" : "Active"}
                      </span>
                    </p>
                    <h2 className="mt-1 truncate text-base font-black text-gray-900">
                      {r.topic}
                    </h2>
                    <p className="mt-1 text-xs text-gray-500">
                      {r.roles.includes("moderator") && r.roles.includes("delegate")
                        ? "Moderator & delegate"
                        : r.roles.includes("moderator")
                          ? "Moderator"
                          : "Delegate"}
                    </p>
                  </div>
                  <Link
                    href={`/forum/${r.id}/vote/results`}
                    className="inline-flex shrink-0 items-center justify-center gap-1 rounded-xl border border-brand/30 bg-brand/5 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-brand transition-colors hover:bg-brand hover:text-white"
                  >
                    View results
                    <ChevronRight size={16} />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
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
