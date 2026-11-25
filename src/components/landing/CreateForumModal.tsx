import React, { useState, useEffect, useRef } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Users2, Calendar, Clock, ArrowRight, Search, X, Shuffle, Bot, Tag } from "lucide-react";
import { G7_COUNTRIES, getAllCountryEntries, type CountryEntry } from "@/lib/countries";

interface CreateForumModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: any) => void;
}

export const CreateForumModal = ({ isOpen, onClose, onSubmit }: CreateForumModalProps) => {
  const [topic, setTopic] = useState("");
  const [subtopic, setSubtopic] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [count, setCount] = useState(30);
  const [isG7, setIsG7] = useState(false);

  const [allCountries, setAllCountries] = useState<CountryEntry[]>([]);
  const [selectedCountries, setSelectedCountries] = useState<CountryEntry[]>([]);
  const [search, setSearch] = useState("");
  const [loadingCountries, setLoadingCountries] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [aiCountryCodes, setAiCountryCodes] = useState<string[]>([]);
  const searchRef = useRef<HTMLDivElement>(null);

  const presets = ["G7", "10 Countries", "30 Countries", "50 Countries"];

  // 전체 국가 목록 로드
  useEffect(() => {
    if (!isG7 && allCountries.length === 0) {
      setLoadingCountries(true);
      getAllCountryEntries()
        .then(setAllCountries)
        .catch(console.error)
        .finally(() => setLoadingCountries(false));
    }
  }, [isG7, allCountries.length]);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // 모달 닫힐 때 초기화
  useEffect(() => {
    if (!isOpen) {
      setTopic("");
      setSubtopic("");
      setDate("");
      setTime("");
      setCount(30);
      setIsG7(false);
      setSelectedCountries([]);
      setSearch("");
      setAiCountryCodes([]);
    }
  }, [isOpen]);

  const handlePreset = (preset: string) => {
    if (preset === "G7") {
      setCount(7);
      setIsG7(true);
      setSelectedCountries(G7_COUNTRIES);
      setAiCountryCodes([]);
    } else {
      const n = parseInt(preset);
      setCount(n);
      setIsG7(false);
      setSelectedCountries([]);
      setAiCountryCodes([]);
    }
  };

  const handleSliderChange = (value: number) => {
    setCount(value);
    if (value === 7) {
      setIsG7(true);
      setSelectedCountries(G7_COUNTRIES);
      setAiCountryCodes([]);
    } else {
      setIsG7(false);
      setSelectedCountries((prev) => {
        const trimmed = prev.length > value ? prev.slice(0, value) : prev;
        setAiCountryCodes((codes) =>
          codes.filter((code) => trimmed.some((c) => c.code === code)),
        );
        return trimmed;
      });
    }
  };

  const filteredCountries = allCountries.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) &&
      !selectedCountries.some((s) => s.code === c.code)
  );

  const addCountry = (country: CountryEntry) => {
    if (selectedCountries.length >= count) return;
    setSelectedCountries((prev) => [...prev, country]);
    setSearch("");
  };

  const removeCountry = (code: string) => {
    setSelectedCountries((prev) => prev.filter((c) => c.code !== code));
    setAiCountryCodes((prev) => prev.filter((v) => v !== code));
    if (isG7) setIsG7(false);
  };

  const toggleAICountry = (code: string) => {
    setAiCountryCodes((prev) =>
      prev.includes(code) ? prev.filter((v) => v !== code) : [...prev, code],
    );
  };

  const enableAIForAllSelected = () => {
    setAiCountryCodes(finalCountries.map((c) => c.code));
  };

  const disableAIForAllSelected = () => {
    setAiCountryCodes([]);
  };

  const handleRandomCountries = async () => {
    const remaining = count - selectedCountries.length;
    if (remaining <= 0) return;
    setLoadingCountries(true);
    try {
      const all = await getAllCountryEntries();
      const existingCodes = new Set(selectedCountries.map((c) => c.code));
      const pool = all.filter((c) => !existingCodes.has(c.code));
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      setSelectedCountries((prev) => [...prev, ...shuffled.slice(0, remaining)]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingCountries(false);
    }
  };

  const finalCountries = isG7 ? G7_COUNTRIES : selectedCountries;

  const handleSubmit = () => {
    if (!topic || !date || !time || finalCountries.length === 0) return;
    onSubmit({
      topic,
      // 빈 값이면 필드 자체를 생략 (Firestore는 undefined 값을 거부)
      ...(subtopic.trim() ? { subtopic: subtopic.trim() } : {}),
      date,
      time,
      count: finalCountries.length,
      forumType: isG7 ? "g7" : "custom",
      countries: finalCountries.map((country) => ({
        ...country,
        isAI: aiCountryCodes.includes(country.code),
      })),
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Forum Details">
      <div className="flex flex-col gap-5">
        <p className="text-sm text-gray-400 -mt-2">Configure the basic settings for your forum</p>

        <div className="space-y-4">
          {/* Topic */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-bold text-gray-700">
              <Users2 size={16} className="text-brand" />
              Topic
            </label>
            <input
              type="text"
              placeholder="Enter forum topic (e.g., Climate Change and International Cooperation)"
              className="w-full rounded-md border border-gray-200 px-3 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/5 transition-all"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-bold text-gray-700">
              <Tag size={16} className="text-brand" />
              Subtopic
              <span className="text-[10px] font-semibold text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="Narrow the focus (e.g., island nations & sea-level rise)"
              className="w-full rounded-md border border-gray-200 px-3 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/5 transition-all"
              value={subtopic}
              onChange={(e) => setSubtopic(e.target.value)}
            />
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm font-bold text-gray-700">
                <Calendar size={16} className="text-brand" />
                Date
              </label>
              <input
                type="date"
                className="w-full rounded-md border border-gray-200 px-3 py-2.5 text-sm focus:border-brand focus:outline-none transition-all"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm font-bold text-gray-700">
                <Clock size={16} className="text-brand" />
                Duration (Min)
              </label>
              <div className="flex gap-2 h-[42px]">
                {[30, 60].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTime(t.toString())}
                    className={`flex-1 rounded-md border font-bold text-sm transition-all ${
                      time === t.toString()
                        ? "bg-brand text-white border-brand shadow-md"
                        : "bg-white text-gray-500 border-gray-200 hover:border-brand/40"
                    }`}
                  >
                    {t} Min
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Slider Section */}
          <div className="space-y-3">
            <label className="text-sm font-bold text-gray-700 block">Number of Participating Countries</label>

            <div className="rounded-xl border border-gray-100 bg-gray-50/30 px-6 py-4">
              <div className="flex items-end justify-between mb-3">
                <span className="text-[10px] font-bold text-gray-400">Min: 7</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-4xl font-black text-brand tracking-tighter">{count}</span>
                  {isG7 && <span className="text-xs font-black text-brand/60">G7</span>}
                </div>
                <span className="text-[10px] font-bold text-gray-400">Max: 50</span>
              </div>

              <div className="relative h-2 w-full bg-gray-100 rounded-full">
                <div
                  className="absolute h-full bg-brand rounded-full transition-all"
                  style={{ width: `${((count - 7) / 43) * 100}%` }}
                />
                <input
                  type="range"
                  min="7"
                  max="50"
                  value={count}
                  onChange={(e) => handleSliderChange(parseInt(e.target.value))}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div
                  className="absolute h-4 w-4 bg-white border-2 border-brand rounded-full top-1/2 -ml-2 -mt-2 pointer-events-none transition-all"
                  style={{ left: `${((count - 7) / 43) * 100}%` }}
                />
              </div>
            </div>

            {/* Presets */}
            <div className="grid grid-cols-4 gap-2">
              {presets.map((preset) => {
                const isActive =
                  (preset === "G7" && isG7) ||
                  (preset !== "G7" && !isG7 && parseInt(preset) === count);
                return (
                  <button
                    key={preset}
                    onClick={() => handlePreset(preset)}
                    className={`rounded-md border py-1.5 text-xs font-bold transition-all ${
                      isActive
                        ? "bg-brand text-white border-brand shadow-md"
                        : "bg-white text-gray-600 border-gray-200 hover:border-brand/40"
                    }`}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 국가 배치 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold text-gray-700">
                Countries
                <span className="ml-2 text-brand">({finalCountries.length}/{count})</span>
              </label>
              {!isG7 && (
                <button
                  type="button"
                  onClick={handleRandomCountries}
                  disabled={loadingCountries}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-bold text-gray-600 hover:border-brand/40 hover:text-brand transition-all disabled:opacity-50"
                >
                  <Shuffle size={12} />
                  Random
                </button>
              )}
            </div>

            {/* 검색 (G7 아닐 때) */}
            {!isG7 && (
              <div ref={searchRef} className="relative">
                <div className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/5 transition-all">
                  <Search size={14} className="text-gray-400 shrink-0" />
                  <input
                    type="text"
                    placeholder={
                      loadingCountries
                        ? "Loading countries..."
                        : selectedCountries.length >= count
                          ? `Maximum ${count} countries reached`
                          : "Search countries to add..."
                    }
                    className="flex-1 text-sm outline-none bg-transparent"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      if (searchRef.current) {
                        const rect = searchRef.current.getBoundingClientRect();
                        setDropUp(window.innerHeight - rect.bottom < 220);
                      }
                      setShowDropdown(true);
                    }}
                    onFocus={() => {
                      if (searchRef.current) {
                        const rect = searchRef.current.getBoundingClientRect();
                        setDropUp(window.innerHeight - rect.bottom < 220);
                      }
                      setShowDropdown(true);
                    }}
                    disabled={loadingCountries || selectedCountries.length >= count}
                  />
                </div>

                {showDropdown && search && filteredCountries.length > 0 && (
                  <div className="absolute bottom-full mb-2 z-[110] w-full max-h-40 overflow-y-auto rounded-lg border border-gray-100 bg-white shadow-2xl custom-scrollbar animate-in fade-in slide-in-from-bottom-2 duration-200">
                    {filteredCountries.slice(0, 20).map((c) => (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => {
                          addCountry(c);
                          setShowDropdown(false);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-brand/5 transition-colors"
                      >
                        <img
                          src={`https://flagcdn.com/w40/${c.code}.png`}
                          className="w-5 h-3.5 rounded-sm object-cover shadow-sm"
                          alt={c.name}
                        />
                        <span className="font-medium text-gray-700">{c.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 선택된 국가 (고정 높이 내부 스크롤) */}
            <div className="h-[100px] rounded-xl border border-gray-100 bg-gray-50/30 p-2 overflow-y-auto custom-scrollbar">
              {finalCountries.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {finalCountries.map((c) => (
                    <div
                      key={c.code}
                      className={`flex items-center gap-1.5 rounded-lg border pl-2 pr-1.5 py-0.5 ${
                        isG7
                          ? "border-brand/20 bg-brand/5"
                          : "border-gray-200 bg-white"
                      }`}
                    >
                      <img
                        src={`https://flagcdn.com/w40/${c.code}.png`}
                        className="w-4 h-3 rounded-sm object-cover shadow-sm"
                        alt={c.name}
                      />
                      <span className="text-[11px] font-bold text-gray-700">{c.name}</span>
                      <button
                        type="button"
                        onClick={() => toggleAICountry(c.code)}
                        className={`ml-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider border transition-all ${
                          aiCountryCodes.includes(c.code)
                            ? "border-purple-300 bg-purple-100 text-purple-700"
                            : "border-gray-200 bg-gray-50 text-gray-400 hover:border-purple-200 hover:text-purple-600"
                        }`}
                        title="Toggle AI delegation for this country"
                      >
                        <Bot size={9} />
                        AI
                      </button>
                      {!isG7 && (
                        <button
                          type="button"
                          onClick={() => removeCountry(c.code)}
                          className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-gray-400 hover:bg-red-100 hover:text-red-500 transition-all"
                        >
                          <X size={8} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-xs text-gray-400">
                    Search to add countries or click &quot;Random&quot; to auto-fill {count} countries
                  </p>
                </div>
              )}
            </div>
            {finalCountries.length > 0 ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-purple-700/80">
                  AI enabled countries: <span className="font-black">{aiCountryCodes.length}</span> / {finalCountries.length}
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={enableAIForAllSelected}
                    className="rounded-md border border-purple-200 bg-purple-50 px-2 py-1 text-[10px] font-black text-purple-700 hover:bg-purple-600 hover:text-white transition-all"
                  >
                    AI ALL ON
                  </button>
                  <button
                    type="button"
                    onClick={disableAIForAllSelected}
                    className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] font-black text-gray-500 hover:bg-gray-100 transition-all"
                  >
                    AI ALL OFF
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-purple-700/80">
                Add countries first. Then use each country&apos;s <span className="font-black">AI</span> chip to enable delegation.
              </p>
            )}
          </div>
        </div>

        <Button
          size="lg"
          className="w-full justify-center gap-2 bg-brand text-white hover:bg-brand-hover shadow-lg shadow-brand/20 py-5 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleSubmit}
          disabled={!topic || !date || !time || finalCountries.length === 0}
        >
          <span className="text-base font-bold">Save Forum & Continue</span>
          <ArrowRight size={18} />
        </Button>
      </div>
    </Modal>
  );
};
