"use client";

import { useEffect, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { PublicForumState } from "@/engine/publicView";
import type { RecordEntry } from "@/engine/types";

export type ForumMeta = {
  title: string;
  agenda: string;
  committeeId: string;
  ownerUid: string;
  joinCode?: string;
  status: "lobby" | "live" | "closed";
  durationMin: number;
};

export type Membership = { countryCode: string; role: string } | null;

/**
 * Live subscription to the server-owned projection of a forum. Everything shown in the room comes
 * from here, so all participants see the same phase, deadlines, motions and results.
 */
export function useForumLive(forumId: string, uid: string | null) {
  const [membership, setMembership] = useState<Membership | undefined>(undefined);
  const [meta, setMeta] = useState<ForumMeta | null>(null);
  const [state, setState] = useState<PublicForumState | null>(null);
  const [record, setRecord] = useState<RecordEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!forumId || !uid) return;
    return onSnapshot(
      doc(db, "forums", forumId, "members", uid),
      (snap) => setMembership(snap.exists() ? (snap.data() as { countryCode: string; role: string }) : null),
      () => setMembership(null),
    );
  }, [forumId, uid]);

  const isMember = !!membership;

  useEffect(() => {
    if (!forumId || !isMember) return;
    const unsubs = [
      onSnapshot(doc(db, "forums", forumId), (s) => setMeta(s.exists() ? (s.data() as ForumMeta) : null), (e) => setError(e.message)),
      onSnapshot(
        doc(db, "forums", forumId, "engine", "public"),
        (s) => setState(s.exists() ? ((s.data() as { state: PublicForumState }).state ?? null) : null),
        (e) => setError(e.message),
      ),
      onSnapshot(
        query(collection(db, "forums", forumId, "record"), orderBy("seq", "desc"), limit(200)),
        (s) => setRecord(s.docs.map((d) => d.data() as RecordEntry).reverse()),
        (e) => setError(e.message),
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [forumId, isMember]);

  return { membership, meta, state, record, error };
}
