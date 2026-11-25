"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Copy, Crown, Info, Play, User } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useModal } from "@/context/ModalContext";
import { COMMITTEES } from "@/engine/committees";
import { POLICY_SOURCE_NOTE } from "@/engine/policies";
import type { PublicForumState } from "@/engine/publicView";
import type { ForumMeta } from "@/hooks/useForumLive";
import type { useForumActions } from "@/hooks/useForumActions";

export type ForumViewProps = {
  forumId: string;
  uid: string;
  mySeat: string;
  meta: ForumMeta;
  state: PublicForumState;
  actions: ReturnType<typeof useForumActions>;
};

/** Waiting room: share the code, see who holds which country, owner starts (fixes the roster). */
export function Lobby({ uid, mySeat, meta, state, actions }: ForumViewProps) {
  const router = useRouter();
  const { showConfirm } = useModal();
  const [copied, setCopied] = useState(false);
  const isOwner = state.ownerUid === uid;
  const seats = Object.values(state.seats).sort((a, b) => a.countryName.localeCompare(b.countryName));
  const humans = seats.filter((s) => s.kind === "human");
  const committee = COMMITTEES.find((c) => c.id === state.committeeId);

  const start = async () => {
    const ok = await showConfirm(
      `Start now with ${humans.length} human delegate(s) and ${seats.length - humans.length} AI delegation(s)? Seats are fixed once started and new people can no longer join.`,
      "Start forum",
    );
    if (ok) await actions.send({ type: "start" });
  };

  return (
    <div className="min-h-screen bg-[#f1f5f9] px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-brand">Waiting room</p>
          <h1 className="mt-1 text-2xl font-black text-gray-900">{meta.title}</h1>
          <p className="mt-1 text-sm text-gray-600">
            <span className="font-bold">{committee?.id.replace("_HMUN", "")}</span> · {meta.agenda} · {meta.durationMin} min
          </p>
          {committee?.disclaimer && <p className="mt-1 text-xs font-semibold text-amber-700">{committee.disclaimer}</p>}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div className="rounded-xl border-2 border-dashed border-brand/30 bg-brand-light px-5 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Join code</p>
              <p className="font-mono text-3xl font-black tracking-[0.35em] text-brand">{meta.joinCode}</p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(meta.joinCode ?? "");
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              <Copy size={14} className="mr-2" /> {copied ? "Copied" : "Copy code"}
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-widest text-gray-800">
              Delegations ({humans.length} people · {seats.length - humans.length} AI)
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
            {seats.map((s) => (
              <div key={s.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${s.id === mySeat ? "border-brand bg-brand/5" : "border-gray-100"}`}>
                <img src={`https://flagcdn.com/w40/${s.id}.png`} alt="" className="h-4 w-6 rounded-sm object-cover" />
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-gray-800">{s.countryName}</span>
                {s.kind === "human" ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-brand">
                    {s.uid === state.ownerUid ? <Crown size={11} /> : <User size={11} />} {s.id === mySeat ? "You" : "Delegate"}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-purple-600">
                    <Bot size={11} /> AI
                  </span>
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-500">
            The room owner ({isOwner ? "you" : "crown"}) is a country delegate with room controls (start, app pause) only. The chair is automatic.
          </p>
        </div>

        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <Info size={16} className="mt-0.5 shrink-0" />
          <p>{POLICY_SOURCE_NOTE.sessionEnd}</p>
        </div>

        {actions.error && <p className="text-sm font-semibold text-red-600">{actions.error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {!isOwner && (
            <Button
              variant="outline"
              onClick={async () => {
                if (await actions.send({ type: "release_seat", seat: mySeat })) router.push("/");
              }}
            >
              Leave seat
            </Button>
          )}
          {isOwner ? (
            <Button disabled={actions.busy} onClick={() => void start()}>
              <Play size={16} className="mr-2" /> Start forum
            </Button>
          ) : (
            <p className="self-center text-sm text-gray-500">Waiting for the room owner to start…</p>
          )}
        </div>
      </div>
    </div>
  );
}
