"use client";

import React, { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Shuffle, ArrowRight, Search } from "lucide-react";

interface CountryEntry {
  name: string;
  code: string;
  isAI?: boolean;
}

interface Participant {
  userId: string;
  userName: string;
  country: CountryEntry;
}

interface CountrySelectModalProps {
  isOpen: boolean;
  countries: CountryEntry[];
  participants: Participant[];
  onSelect: (country: CountryEntry) => void;
  /** X 버튼·오버레이 닫기 시 (예: 랜딩으로 이동) */
  onDismiss?: () => void;
}

export const CountrySelectModal = ({
  isOpen,
  countries,
  participants,
  onSelect,
  onDismiss,
}: CountrySelectModalProps) => {
  const [selected, setSelected] = useState<CountryEntry | null>(null);
  const [search, setSearch] = useState("");

  const takenCodes = new Set(participants.map((p) => p.country.code));
  const aiCodes = new Set(countries.filter((c) => c.isAI).map((c) => c.code));

  const available = countries.filter(
    (c) =>
      !takenCodes.has(c.code) &&
      !aiCodes.has(c.code) &&
      c.name.toLowerCase().includes(search.toLowerCase())
  );

  const taken = countries.filter((c) => takenCodes.has(c.code));
  const blockedByAI = countries.filter((c) => aiCodes.has(c.code) && !takenCodes.has(c.code));

  const handleRandom = () => {
    const pool = countries.filter((c) => !takenCodes.has(c.code) && !aiCodes.has(c.code));
    if (pool.length === 0) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    setSelected(pick);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => onDismiss?.()}
      title="Select Your Country"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-400 -mt-2">
          Choose a country to represent in this forum
        </p>

        {/* 검색 + 랜덤 */}
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/5 transition-all">
            <Search size={14} className="text-gray-400 shrink-0" />
            <input
              type="text"
              placeholder="Search available countries..."
              className="flex-1 text-sm outline-none bg-transparent"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={handleRandom}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 hover:border-brand/40 hover:text-brand transition-all shrink-0"
          >
            <Shuffle size={14} />
            Random
          </button>
        </div>

        {/* 선택된 국가 미리보기 */}
        {selected && (
          <div className="flex items-center gap-3 rounded-xl border-2 border-brand bg-brand/5 px-4 py-3">
            <img
              src={`https://flagcdn.com/w80/${selected.code}.png`}
              className="w-10 h-7 rounded object-cover shadow-sm"
              alt={selected.name}
            />
            <div>
              <p className="text-sm font-black text-gray-900">{selected.name}</p>
              <p className="text-[10px] font-bold text-brand uppercase tracking-wider">
                Selected
              </p>
            </div>
          </div>
        )}

        {/* 국가 목록 */}
        <div className="h-[200px] overflow-y-auto custom-scrollbar rounded-xl border border-gray-100 bg-gray-50/30 p-2">
          {available.length > 0 ? (
            <div className="grid grid-cols-2 gap-1.5">
              {available.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => setSelected(c)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all ${
                    selected?.code === c.code
                      ? "border-brand bg-brand/5 shadow-sm"
                      : "border-transparent bg-white hover:border-gray-200 hover:shadow-sm"
                  }`}
                >
                  <img
                    src={`https://flagcdn.com/w40/${c.code}.png`}
                    className="w-5 h-3.5 rounded-sm object-cover shadow-sm shrink-0"
                    alt={c.name}
                  />
                  <span className="text-xs font-bold text-gray-700 truncate">
                    {c.name}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-xs text-gray-400">No available countries</p>
            </div>
          )}
        </div>

        {/* 이미 배정된 국가 표시 */}
        {taken.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              Already Taken ({taken.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {taken.map((c) => {
                const p = participants.find((x) => x.country.code === c.code);
                return (
                  <div
                    key={c.code}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-100 bg-gray-50 px-2 py-0.5 opacity-50"
                  >
                    <img
                      src={`https://flagcdn.com/w40/${c.code}.png`}
                      className="w-4 h-3 rounded-sm object-cover"
                      alt={c.name}
                    />
                    <span className="text-[10px] font-bold text-gray-500">
                      {c.name}
                    </span>
                    {p && (
                      <span className="text-[9px] text-gray-400">
                        · {p.userName}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {blockedByAI.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold text-purple-500 uppercase tracking-wider">
              Reserved For AI ({blockedByAI.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {blockedByAI.map((c) => (
                <div
                  key={c.code}
                  className="flex items-center gap-1.5 rounded-lg border border-purple-100 bg-purple-50 px-2 py-0.5"
                >
                  <img
                    src={`https://flagcdn.com/w40/${c.code}.png`}
                    className="w-4 h-3 rounded-sm object-cover"
                    alt={c.name}
                  />
                  <span className="text-[10px] font-bold text-purple-700">
                    {c.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 입장 버튼 */}
        <Button
          size="lg"
          className="w-full justify-center gap-2 bg-brand text-white hover:bg-brand-hover shadow-lg shadow-brand/20 py-5 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => selected && onSelect(selected)}
          disabled={!selected}
        >
          <span className="text-base font-bold">Enter Forum</span>
          <ArrowRight size={18} />
        </Button>
      </div>
    </Modal>
  );
};
