import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type ForumSpeechLine = {
  id: string;
  userName: string;
  text: string;
  sourceType?: "human" | "ai";
  countryName?: string;
  countryCode?: string;
};

export function useForumSpeeches(forumId: string) {
  const [speeches, setSpeeches] = useState<ForumSpeechLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!forumId) return;
    const q = query(
      collection(db, "forums", forumId, "speeches"),
      orderBy("createdAt", "asc"),
    );
    return onSnapshot(
      q,
      (snap) => {
        setSpeeches(
          snap.docs.map((d) => {
            const x = d.data() as Record<string, unknown>;
            const country = x.country as
              | { name?: string; code?: string }
              | undefined;
            return {
              id: d.id,
              userName: typeof x.userName === "string" ? x.userName : "",
              text: typeof x.text === "string" ? x.text : "",
              sourceType:
                x.sourceType === "ai" || x.sourceType === "human"
                  ? x.sourceType
                  : undefined,
              countryName: country?.name,
              countryCode: country?.code,
            };
          }),
        );
        setLoading(false);
      },
      (err) => {
        console.error("forum speeches snapshot", err);
        setLoading(false);
      },
    );
  }, [forumId]);

  return { speeches, loading };
}
