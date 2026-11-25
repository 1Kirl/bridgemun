"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, User } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { explainError, forumApi, type LobbyInfo } from "@/lib/forumClient";

type Props = { isOpen: boolean; onClose: () => void; initialCode?: string };

/** Join Forum: code → choose a country (replacing its AI delegation) → waiting room. */
export function JoinForumModal({ isOpen, onClose, initialCode = "" }: Props) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [info, setInfo] = useState<LobbyInfo | null>(null);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setInfo(null);
    setPicked("");
    setError(null);
  };

  const lookup = async () => {
    setBusy(true);
    setError(null);
    try {
      const l = await forumApi.lookup(code);
      if (l.isMember) {
        onClose();
        router.push(`/forum/${l.forumId}`); // already seated: this is a reconnect, not a new join
        return;
      }
      setInfo(l);
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    if (!info || !picked) return;
    setBusy(true);
    setError(null);
    try {
      await forumApi.claimSeat(info.forumId, code, picked);
      onClose();
      router.push(`/forum/${info.forumId}`);
    } catch (e) {
      setError(explainError(e));
      // Refresh the seat list so a seat taken by someone else shows as taken.
      try {
        setInfo(await forumApi.lookup(code));
        setPicked("");
      } catch {
        /* keep previous */
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Join Forum"
    >
      {!info ? (
        <div className="space-y-4">
          <label className="block text-sm font-bold text-gray-700">Forum code</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={8}
            autoFocus
            placeholder="ABC234"
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            onKeyDown={(e) => e.key === "Enter" && void lookup()}
          />
          {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
          <Button className="w-full justify-center py-4" disabled={busy || code.trim().length < 6} onClick={() => void lookup()}>
            {busy ? "Checking…" : "Continue"}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-lg font-black text-gray-900">{info.title}</p>
            <p className="text-sm text-gray-500">
              {info.committeeId.replace("_HMUN", "")} · {info.agenda}
            </p>
          </div>
          <p className="text-sm font-bold text-gray-700">Choose the country you will represent</p>
          <div className="grid max-h-[45vh] grid-cols-2 gap-2 overflow-y-auto pr-1 custom-scrollbar">
            {info.seats.map((s) => {
              const taken = s.kind === "human";
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={taken}
                  onClick={() => setPicked(s.id)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition ${
                    picked === s.id ? "border-brand bg-brand/10" : taken ? "cursor-not-allowed border-gray-100 bg-gray-50 opacity-60" : "border-gray-200 hover:border-brand/40"
                  }`}
                >
                  <img src={`https://flagcdn.com/w40/${s.id}.png`} alt="" className="h-4 w-6 rounded-sm object-cover" />
                  <span className="min-w-0 flex-1 truncate font-bold text-gray-800">{s.countryName}</span>
                  {taken ? (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-black uppercase text-gray-500">
                      <User size={11} /> Taken
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-black uppercase text-purple-600">
                      <Bot size={11} /> AI → you
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 justify-center" onClick={reset}>
              Back
            </Button>
            <Button className="flex-1 justify-center" disabled={!picked || busy} onClick={() => void join()}>
              {busy ? "Joining…" : "Take this seat"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
