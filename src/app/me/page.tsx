"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collectionGroup, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { LoginModal } from "@/components/landing/LoginModal";
import { RegisterModal } from "@/components/landing/RegisterModal";

type Row = { forumId: string; title: string | null; countryCode: string; role: string; joinedAtMs: number };

/** Forums I hold a seat in (server-written membership rows; no legacy collections). */
export default function MyForums() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [login, setLogin] = useState(false);
  const [register, setRegister] = useState(false);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      query(collectionGroup(db, "members"), where("uid", "==", user.uid)),
      (s) => setRows(s.docs.map((d) => d.data() as Row).sort((a, b) => b.joinedAtMs - a.joinedAtMs)),
      (e) => setError(e.message),
    );
  }, [user]);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header onLoginClick={() => setLogin(true)} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pt-28 pb-16">
        <h1 className="text-2xl font-black text-gray-900">My forums</h1>
        {!user && <p className="mt-4 text-gray-500">Sign in to see the forums you joined.</p>}
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        {user && rows && rows.length === 0 && <p className="mt-4 text-gray-500">You have not joined any forum yet.</p>}
        <ul className="mt-6 space-y-2">
          {rows?.map((r) => (
            <li key={r.forumId}>
              <Link href={`/forum/${r.forumId}`} className="flex items-center gap-3 rounded-xl border border-gray-100 px-4 py-3 hover:border-brand/30">
                <img src={`https://flagcdn.com/w40/${r.countryCode}.png`} alt="" className="h-4 w-6 rounded-sm object-cover" />
                <span className="flex-1 font-bold text-gray-800">{r.title ?? r.forumId}</span>
                <span className="text-xs font-bold uppercase text-gray-400">{r.role === "owner" ? "Room owner" : "Delegate"}</span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <Footer />
      <LoginModal isOpen={login} onClose={() => setLogin(false)} onSwitchToRegister={() => { setLogin(false); setRegister(true); }} />
      <RegisterModal isOpen={register} onClose={() => setRegister(false)} onSwitchToLogin={() => { setRegister(false); setLogin(true); }} />
    </div>
  );
}
