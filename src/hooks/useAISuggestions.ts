import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type AISuggestionCandidate = {
  stance: "pro" | "con";
  text: string;
  rationale: string;
};

export type AISuggestion = {
  id: string;
  forumId: string;
  countryCode: string;
  countryName: string;
  status: "generated" | "approved" | "rejected" | "published";
  candidates: AISuggestionCandidate[];
  selectedStance?: "pro" | "con";
  createdAt: any;
  createdBy?: string;
  approvedBy?: string;
};

type GeneratePayload = {
  forumId: string;
  topic: string;
  /** Narrows debate scope for AI prompts */
  subtopic?: string;
  countryCode: string;
  countryName: string;
  /** Full feed, chronological (oldest first). Server builds the prompt transcript. */
  recentSpeeches: Array<{
    userName?: string;
    text?: string;
    sourceType?: "human" | "ai";
    countryName?: string;
    countryCode?: string;
  }>;
  roleProfile?: string;
  userId?: string;
};

export function useAISuggestions(forumId: string) {
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  /** Which country code is currently generating (for per-card loading UI). */
  const [loadingCountryCode, setLoadingCountryCode] = useState<string | null>(null);

  useEffect(() => {
    if (!forumId) return;
    const q = query(
      collection(db, "forums", forumId, "aiSuggestions"),
      orderBy("createdAt", "desc"),
    );
    return onSnapshot(
      q,
      (snap) => {
        setSuggestions(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AISuggestion),
        );
      },
      (err) => {
        console.error("Firestore aiSuggestions error:", err);
      },
    );
  }, [forumId]);

  const generateSuggestion = async (payload: GeneratePayload) => {
    setLoading(true);
    setLoadingCountryCode(payload.countryCode);
    try {
      const res = await fetch("/api/ai/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to generate AI suggestion");
      }

      await addDoc(collection(db, "forums", payload.forumId, "aiSuggestions"), {
        forumId: payload.forumId,
        countryCode: payload.countryCode,
        countryName: payload.countryName,
        status: "generated",
        candidates: data.candidates,
        model: data.model || "gemini-2.0-flash",
        createdBy: payload.userId || null,
        createdAt: serverTimestamp(),
      });
    } finally {
      setLoading(false);
      setLoadingCountryCode(null);
    }
  };

  const publishSuggestion = async (
    suggestion: AISuggestion,
    stance: "pro" | "con",
    moderatorId?: string,
  ) => {
    const picked = suggestion.candidates.find((c) => c.stance === stance);
    if (!picked) throw new Error("Selected stance not found");

    await updateDoc(
      doc(db, "forums", forumId, "aiSuggestions", suggestion.id),
      {
        status: "published",
        selectedStance: stance,
        approvedBy: moderatorId || null,
        approvedAt: serverTimestamp(),
      },
    );

    await addDoc(collection(db, "forums", forumId, "speeches"), {
      userId: `ai:${suggestion.countryCode}`,
      userName: `${suggestion.countryName} (AI)`,
      sourceType: "ai",
      country: {
        name: suggestion.countryName,
        code: suggestion.countryCode,
      },
      text: picked.text,
      rationale: picked.rationale,
      createdAt: serverTimestamp(),
    });
  };

  const rejectSuggestion = async (suggestionId: string, moderatorId?: string) => {
    await updateDoc(doc(db, "forums", forumId, "aiSuggestions", suggestionId), {
      status: "rejected",
      approvedBy: moderatorId || null,
      approvedAt: serverTimestamp(),
    });
  };

  return {
    suggestions,
    loading,
    loadingCountryCode,
    generateSuggestion,
    publishSuggestion,
    rejectSuggestion,
  };
}
