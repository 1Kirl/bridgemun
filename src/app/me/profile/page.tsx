"use client";

import { useState } from "react";
import Link from "next/link";
import { updateProfile } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { Button } from "@/components/ui/Button";

/** Display name only. (Legacy debate-history queries were removed with the legacy collections.) */
export default function Profile() {
  const { user } = useAuth();
  const [edited, setName] = useState<string | null>(null);
  const name = edited ?? user?.displayName ?? "";
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    if (!user || !auth.currentUser) return;
    await updateProfile(auth.currentUser, { displayName: name.trim() });
    await setDoc(doc(db, "users", user.uid), { displayName: name.trim(), updatedAt: serverTimestamp() }, { merge: true });
    setMsg("Profile updated.");
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header onLoginClick={() => {}} />
      <main className="mx-auto w-full max-w-xl flex-1 px-6 pt-28 pb-16">
        <h1 className="text-2xl font-black text-gray-900">Profile</h1>
        {!user ? (
          <p className="mt-4 text-gray-500">Sign in to edit your profile.</p>
        ) : (
          <div className="mt-6 space-y-3">
            <label className="block text-sm font-bold text-gray-700">Your name in sessions</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm" maxLength={60} />
            <Button disabled={!name.trim()} onClick={() => void save()}>
              Save
            </Button>
            {msg && <p className="text-sm text-emerald-700">{msg}</p>}
            <p className="pt-4 text-sm">
              <Link href="/me" className="font-bold text-brand">
                My forums →
              </Link>
            </p>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
