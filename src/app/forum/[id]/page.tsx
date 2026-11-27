"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useForumLive } from "@/hooks/useForumLive";
import { useServerClock } from "@/hooks/useServerClock";
import { useForumActions } from "@/hooks/useForumActions";
import { Lobby } from "@/components/forum/Lobby";
import { Room } from "@/components/forum/room/Room";
import { JoinForumModal } from "@/components/landing/JoinForumModal";
import { Button } from "@/components/ui/Button";

export default function ForumPage() {
  const params = useParams();
  const forumId = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const { user, loading } = useAuth();
  const live = useForumLive(forumId, user?.uid ?? null);
  const clock = useServerClock();
  const isMember = !!live.membership;
  const actions = useForumActions(forumId, live.state, clock.now, isMember && live.state?.phase.type !== "CLOSED");
  const [joinOpen, setJoinOpen] = useState(false);

  if (loading) return <Center>Loading…</Center>;
  if (!user)
    return (
      <Center>
        <p className="font-bold text-gray-800">Please sign in to open this forum.</p>
        <Button onClick={() => router.push("/")}>Back to home</Button>
      </Center>
    );
  if (live.membership === undefined) return <Center>Loading…</Center>;
  if (live.membership === null)
    return (
      <Center>
        <p className="font-bold text-gray-800">You have not joined this forum.</p>
        <p className="text-sm text-gray-500">Ask the room owner for the code. Forums cannot be joined after they start.</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/")}>
            Home
          </Button>
          <Button onClick={() => setJoinOpen(true)}>Enter code</Button>
        </div>
        <JoinForumModal isOpen={joinOpen} onClose={() => setJoinOpen(false)} />
      </Center>
    );
  if (!live.state || !live.meta) return <Center>{live.error ? `Error: ${live.error}` : "Loading forum…"}</Center>;

  const common = { forumId, uid: user.uid, mySeat: live.membership.countryCode, meta: live.meta, state: live.state, actions };
  return live.state.phase.type === "LOBBY" ? <Lobby {...common} /> : <Room {...common} record={live.record} now={clock.now} />;
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="bm-room flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center text-gray-500">{children}</div>;
}
