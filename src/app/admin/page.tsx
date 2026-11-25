"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

export default function AdminDashboard() {
  const [forumCount, setForumCount] = useState<number>(0);
  const [activeForumCount, setActiveForumCount] = useState<number>(0);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "forums"), (snap) => {
      setForumCount(snap.size);
      setActiveForumCount(snap.docs.filter((d) => d.data().status === "active").length);
    });
    return () => unsub();
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-black text-gray-900 tracking-tight">Overview</h1>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-brand/10 shadow-sm bg-gradient-to-br from-white to-brand/5">
          <CardHeader className="pb-2">
            <h2 className="text-[11px] font-black text-brand uppercase tracking-widest">Active Forums</h2>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-black text-gray-900">{activeForumCount}</p>
          </CardContent>
        </Card>

        <Card className="border-gray-100 shadow-sm">
          <CardHeader className="pb-2">
            <h2 className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Total Forums</h2>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-black text-gray-900">{forumCount}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
