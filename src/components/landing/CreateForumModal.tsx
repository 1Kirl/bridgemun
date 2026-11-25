"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Info, Search, Shuffle, X } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { COMMITTEES, suggestCommittees, type CommitteeId } from "@/engine/committees";
import { MIN_SEATS } from "@/engine/documents";
import { G7_COUNTRIES, getAllCountryEntries, type CountryEntry } from "@/lib/countries";
import { explainError, forumApi } from "@/lib/forumClient";

type Props = { isOpen: boolean; onClose: () => void };

const DURATIONS = [30, 45, 60, 90];
const PRESETS: Array<{ label: string; n: number | "g7" }> = [
  { label: "G7", n: "g7" },
  { label: "5", n: 5 },
  { label: "10", n: 10 },
  { label: "20", n: 20 },
];

const field = "w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15";
const label = "mb-1.5 block text-sm font-bold text-gray-700";

/**
 * Create Forum: basic settings first, timing details folded away.
 * Internal rule decisions (D1–D7) are fixed app policies and are NOT asked here.
 */
export function CreateForumModal({ isOpen, onClose }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [agenda, setAgenda] = useState("");
  const [committeeId, setCommitteeId] = useState<CommitteeId>("DISEC");
  const [committeeTouched, setCommitteeTouched] = useState(false);
  const [countries, setCountries] = useState<CountryEntry[]>([]);
  const [ownerCountry, setOwnerCountry] = useState("");
  const [durationMin, setDurationMin] = useState(60);
  const [speakingTimeSec, setSpeakingTimeSec] = useState(60);
  const [advanced, setAdvanced] = useState(false);
  const [timers, setTimers] = useState({ motionWindowSec: 45, readingSec: 10, votingSec: 45, humanPrepSec: 10 });
  const [all, setAll] = useState<CountryEntry[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && all.length === 0) getAllCountryEntries().then(setAll).catch(() => setAll([]));
  }, [isOpen, all.length]);

  const suggested = useMemo(() => suggestCommittees(agenda), [agenda]);
  useEffect(() => {
    if (!committeeTouched && suggested[0]) setCommitteeId(suggested[0]);
  }, [suggested, committeeTouched]);

  const committee = COMMITTEES.find((c) => c.id === committeeId)!;
  const matches = search.trim()
    ? all.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()) && !countries.some((x) => x.code === c.code)).slice(0, 8)
    : [];

  const preset = (n: number | "g7") => {
    if (n === "g7") return setCountries(G7_COUNTRIES);
    const pool = [...all].sort(() => Math.random() - 0.5).slice(0, n);
    setCountries(pool);
  };
  const add = (c: CountryEntry) => {
    setCountries((xs) => [...xs, c]);
    setSearch("");
    searchRef.current?.focus();
  };
  const remove = (code: string) => {
    setCountries((xs) => xs.filter((x) => x.code !== code));
    if (ownerCountry === code) setOwnerCountry("");
  };

  const canSubmit =
    title.trim() && agenda.trim() && committee.supportLevel !== "planned" && countries.length >= MIN_SEATS && ownerCountry && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { forumId } = await forumApi.create({
        title: title.trim(),
        agenda: agenda.trim(),
        committeeId,
        countries: countries.map((c) => ({ code: c.code, name: c.name })),
        ownerCountry,
        durationMin,
        speakingTimeSec,
        timers,
      });
      onClose();
      router.push(`/forum/${forumId}`);
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create Forum">
      <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1 custom-scrollbar">
        <div>
          <label className={label}>Forum name</label>
          <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Seoul Model UN — Session 1" maxLength={120} />
        </div>
        <div>
          <label className={label}>Agenda</label>
          <input className={field} value={agenda} onChange={(e) => setAgenda(e.target.value)} placeholder="e.g. Verification of autonomous weapons systems" maxLength={300} />
        </div>
        <div>
          <label className={label}>Committee</label>
          <select
            className={field}
            value={committeeId}
            onChange={(e) => {
              setCommitteeId(e.target.value as CommitteeId);
              setCommitteeTouched(true);
            }}
          >
            {COMMITTEES.map((c) => (
              <option key={c.id} value={c.id} disabled={c.supportLevel === "planned"}>
                {c.id.replace("_HMUN", "")} — {c.name}
                {c.supportLevel === "planned" ? " (not available yet)" : ""}
                {suggested.includes(c.id) ? " · suggested" : ""}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-gray-500">{committee.mandate}</p>
          {committee.disclaimer && <p className="mt-1 text-xs font-semibold text-amber-700">{committee.disclaimer}</p>}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-sm font-bold text-gray-700">
              Participating countries <span className="text-brand">({countries.length})</span>
            </label>
            <div className="flex gap-1.5">
              {PRESETS.map((p) => (
                <button key={p.label} type="button" onClick={() => preset(p.n)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-bold text-gray-600 hover:border-brand/40 hover:text-brand">
                  {p.n !== "g7" && <Shuffle size={11} />} {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-3 text-gray-400" />
            <input ref={searchRef} className={`${field} pl-9`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search and add countries…" />
            {matches.length > 0 && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                {matches.map((c) => (
                  <button key={c.code} type="button" onClick={() => add(c)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-brand-light">
                    <img src={`https://flagcdn.com/w20/${c.code}.png`} alt="" className="h-3 w-5 rounded-sm object-cover" />
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {countries.map((c) => (
              <span key={c.code} className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-bold ${ownerCountry === c.code ? "border-brand bg-brand/10 text-brand" : "border-gray-200 text-gray-700"}`}>
                <img src={`https://flagcdn.com/w20/${c.code}.png`} alt="" className="h-3 w-4 rounded-sm object-cover" />
                {c.name}
                <button type="button" onClick={() => remove(c.code)} aria-label={`Remove ${c.name}`} className="text-gray-400 hover:text-red-500">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-gray-500">
            Every country starts as an AI delegation. People who join with the code replace AI seats in the waiting room. Minimum {MIN_SEATS} countries.
          </p>
        </div>

        <div>
          <label className={label}>Your country (you are a delegate, not the chair)</label>
          <select className={field} value={ownerCountry} onChange={(e) => setOwnerCountry(e.target.value)}>
            <option value="">Choose from the participating countries…</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label}>Session length</label>
            <select className={field} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}>
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d} minutes
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Speaking time</label>
            <select className={field} value={speakingTimeSec} onChange={(e) => setSpeakingTimeSec(Number(e.target.value))}>
              {[30, 45, 60, 90, 120].map((d) => (
                <option key={d} value={d}>
                  {d} seconds{d === 60 ? " (HMUN default)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button type="button" onClick={() => setAdvanced((x) => !x)} className="flex items-center gap-1 text-xs font-bold text-gray-500 hover:text-brand">
          <ChevronDown size={14} className={advanced ? "rotate-180" : ""} /> Participation timing (app settings)
        </button>
        {advanced && (
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
            {(
              [
                ["motionWindowSec", "Motion window", [30, 45, 60, 90]],
                ["readingSec", "Reading before a vote", [5, 10, 15, 20]],
                ["votingSec", "Voting time", [30, 45, 60, 90]],
                ["humanPrepSec", "Speaker preparation", [5, 10, 15, 20]],
              ] as const
            ).map(([k, l, opts]) => (
              <div key={k}>
                <label className="mb-1 block text-xs font-bold text-gray-600">{l}</label>
                <select className={field} value={timers[k]} onChange={(e) => setTimers((t) => ({ ...t, [k]: Number(e.target.value) }))}>
                  {opts.map((o) => (
                    <option key={o} value={o}>
                      {o} s
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <p className="col-span-2 text-[11px] text-gray-500">These guarantee time for people to read, propose and vote. They are app settings, not MUN rules.</p>
          </div>
        )}

        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <Info size={16} className="mt-0.5 shrink-0" />
          <p>
            Time-based simulation: if the session time runs out after draft resolutions were introduced, the committee moves directly to final voting.
            This is an app rule, not a motion to close debate. Votes already in progress always get their full time. If no resolution was introduced,
            the forum ends with no resolution adopted.
          </p>
        </div>

        {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
        <Button className="w-full justify-center py-5" disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? "Creating…" : "Create and open waiting room"}
        </Button>
      </div>
    </Modal>
  );
}
