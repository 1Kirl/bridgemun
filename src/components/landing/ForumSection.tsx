import React, { useEffect, useState } from "react";
import { Calendar } from "lucide-react";
import { ForumCard } from "./ForumCard";
import { collection, onSnapshot, query, orderBy, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { isForumUpcomingOnLanding } from "@/lib/forumListing";
import { useAuth } from "@/context/AuthContext";

interface ForumSectionProps {
  /** 비로그인에서 Join 시 로그인 모달 등 */
  onRequireLogin: () => void;
}

export const ForumSection = ({ onRequireLogin }: ForumSectionProps) => {
  const [realForums, setRealForums] = useState<any[]>([]);
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    const q = query(
      collection(db, "forums"), 
      where("status", "==", "active"),
      orderBy("createdAt", "desc")
    );
    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const fetched = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        const upcoming = fetched.filter((f) => isForumUpcomingOnLanding(f));
        setRealForums(upcoming);
      },
      (err) => {
        console.error("Firestore forums error:", err);
      }
    );

    return () => unsubscribe();
  }, []);

  return (
    <section className="mx-auto max-w-7xl px-6 py-20 bg-gray-50/50">
      <div className="mb-12 flex items-center gap-3 justify-center md:justify-start">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-light text-brand shadow-sm">
          <Calendar size={28} />
        </div>
        <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Upcoming Forums</h2>
      </div>
      
      {realForums.length > 0 ? (
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {realForums.map((forum) => (
            <ForumCard 
              key={forum.id} 
              date={forum.createdAt?.toDate 
                ? forum.createdAt.toDate().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                : 'Just now'}
              title={forum.topic}
              subtitle={forum.subtopic}
              participants={forum.count} 
              buttonText="Join Forum"
              onActionClick={() => {
                if (loading) return;
                if (!user) {
                  onRequireLogin();
                  return;
                }
                router.push(`/forum/${forum.id}`);
              }}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-gray-200">
          <p className="text-gray-500 font-semibold italic">No active forums at the moment. Create the first one!</p>
        </div>
      )}
    </section>
  );
};
