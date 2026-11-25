import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isForumVotingUnlocked } from "@/lib/forumSchedule";

export type VoteChoice = "yes" | "no" | "abstain";

export type ForumVote = {
  id: string;
  userId: string;
  userName: string;
  countryCode: string;
  countryName: string;
  choice: VoteChoice;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function useForumVotes(forumId: string) {
  const [votes, setVotes] = useState<ForumVote[]>([]);

  useEffect(() => {
    if (!forumId) return;
    const col = collection(db, "forums", forumId, "votes");
    return onSnapshot(
      col,
      (snap) => {
        setVotes(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ForumVote),
        );
      },
      (err) => console.error("votes snapshot", err),
    );
  }, [forumId]);

  const tally = useMemo(() => {
    let yes = 0;
    let no = 0;
    let abstain = 0;
    for (const v of votes) {
      if (v.choice === "yes") yes += 1;
      else if (v.choice === "no") no += 1;
      else if (v.choice === "abstain") abstain += 1;
    }
    const cast = yes + no + abstain;
    return { yes, no, abstain, cast };
  }, [votes]);

  const castVote = async (payload: {
    userId: string;
    userName: string;
    countryCode: string;
    countryName: string;
    choice: VoteChoice;
  }) => {
    const forumRef = doc(db, "forums", forumId);
    const forumSnap = await getDoc(forumRef);
    const f = forumSnap.data() as Record<string, unknown> | undefined;
    if (f?.ballotsFinalized === true) {
      throw new Error("Ballots are finalized; voting is closed.");
    }
    const votingWindow =
      (f?.status === "active" && f?.votingOpen === true) ||
      (f?.status === "closed" && isForumVotingUnlocked(f as Parameters<typeof isForumVotingUnlocked>[0]));
    if (!votingWindow) {
      throw new Error("Voting is not open.");
    }

    const ref = doc(db, "forums", forumId, "votes", payload.userId);
    const existing = await getDoc(ref);
    await setDoc(
      ref,
      {
        userId: payload.userId,
        userName: payload.userName,
        countryCode: payload.countryCode,
        countryName: payload.countryName,
        choice: payload.choice,
        updatedAt: serverTimestamp(),
        ...(!existing.exists() ? { createdAt: serverTimestamp() } : {}),
      },
      { merge: true },
    );
  };

  return { votes, tally, castVote };
}
