"use client";

import { useEffect, useState, useRef } from "react";
import { collection, onSnapshot, doc, updateDoc, query, orderBy, deleteDoc, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { useModal } from "@/context/ModalContext";
import { useAuth } from "@/context/AuthContext";
import { Edit2, Eye, StopCircle, Bot, Users2, Shield, Search, Shuffle, Plus } from "lucide-react";
import Link from "next/link";
import { CreateForumModal } from "@/components/landing/CreateForumModal";
import { SelectModeratorModal } from "@/components/admin/SelectModeratorModal";

export default function AdminForumsPage() {
  const [forums, setForums] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { showConfirm, showAlert } = useModal();
  const { user } = useAuth();

  const [isAddingForum, setIsAddingForum] = useState(false);
  const [isSelectingModerator, setIsSelectingModerator] = useState(false);
  const [selectedModerator, setSelectedModerator] = useState<any | null>(null);

  const [editingForum, setEditingForum] = useState<any | null>(null);
  const [forumTopic, setForumTopic] = useState("");
  const [forumSubtopic, setForumSubtopic] = useState("");

  const [editingCountries, setEditingCountries] = useState<any | null>(null);
  const [forumCountries, setForumCountries] = useState<any[]>([]);
  const [forumCount, setForumCount] = useState<number>(30);
  const [availableDbCountries, setAvailableDbCountries] = useState<any[]>([]);

  const [countrySearch, setCountrySearch] = useState("");
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowCountryDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    // DB에서 모든 국가 불러오기 (검색 추가 용도)
    const unsub = onSnapshot(
      collection(db, "admin_countries"),
      (snap) => {
        setAvailableDbCountries(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      },
      (err) => console.error("admin forums: admin_countries snapshot", err),
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "forums"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setForums(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error("admin forums: forums snapshot", err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  const handleForceClose = async (forumId: string) => {
    const ok = await showConfirm(
      "정말 이 포럼을 강제 종료 하시겠습니까? (참가자 모두 즉시 퇴장 처리됩니다)",
      "강제 종료 위험"
    );
    if (!ok) return;

    try {
      await updateDoc(doc(db, "forums", forumId), { status: "closed" });
      await showAlert("포럼이 성공적으로 강제 종료되었습니다.", "종료 완료");
    } catch (e: any) {
      await showAlert(`Error: ${e.message}`, "Error");
    }
  };

  const handleEditClick = (f: any) => {
    setEditingForum(f);
    setForumTopic(f.topic || "");
    setForumSubtopic(f.subtopic || "");
  };

  const handleSaveEdit = async () => {
    if (!editingForum) return;
    try {
      await updateDoc(doc(db, "forums", editingForum.id), {
        topic: forumTopic,
        subtopic: forumSubtopic.trim() || null,
      });
      setEditingForum(null);
      await showAlert("제목이 성공적으로 수정되었습니다.", "수정 완료");
    } catch (e: any) {
      await showAlert(`오류 발생: ${e.message}`, "Error");
    }
  };

  const handleEditCountriesClick = (f: any) => {
    setEditingCountries(f);
    setForumCountries(f.countries || []);
    setForumCount(f.count || (f.countries ? f.countries.length : 30));
  };

  const handleToggleAI = (code: string) => {
    setForumCountries(prev =>
      prev.map(c => c.code === code ? { ...c, isAI: !c.isAI } : c)
    );
  };

  const handleRemoveCountry = (code: string) => {
    setForumCountries(prev => prev.filter(c => c.code !== code));
  };

  const handleAddCountry = (c: any) => {
    if (forumCountries.find(existing => existing.code === c.code)) return;
    if (forumCountries.length >= forumCount) {
      showAlert(`최대 인원(${forumCount}명)을 초과할 수 없습니다. 인원수를 먼저 늘려주세요.`, "Error");
      return;
    }
    setForumCountries(prev => [...prev, { name: c.name, code: c.code, isAI: false }]);
  };

  const handleRandomFill = () => {
    const needed = forumCount - forumCountries.length;
    if (needed <= 0) return;

    const availableToPick = availableDbCountries.filter(
      (c) => !forumCountries.some((fc) => fc.code === c.code)
    );

    if (availableToPick.length === 0) return;

    // Shuffle and pick
    const shuffled = [...availableToPick].sort(() => Math.random() - 0.5);
    const toAdd = shuffled.slice(0, Math.min(needed, shuffled.length));

    setForumCountries((prev) => [
      ...prev,
      ...toAdd.map((c) => ({ name: c.name, code: c.code, isAI: false })),
    ]);
  };

  const handleSaveCountries = async () => {
    if (!editingCountries) return;
    try {
      await updateDoc(doc(db, "forums", editingCountries.id), {
        countries: forumCountries,
        count: forumCount
      });
      setEditingCountries(null);
      await showAlert("참가국 설정이 업데이트 되었습니다.", "Settings Saved");
    } catch (e: any) {
      await showAlert(`Error: ${e.message}`, "Error");
    }
  };

  const handleCreateForum = async (data: any) => {
    if (!selectedModerator) return;
    try {
      await addDoc(collection(db, "forums"), {
        ...data,
        createdBy: selectedModerator.id,
        moderatorName: selectedModerator.displayName,
        createdAt: serverTimestamp(),
        status: "active",
      });
      await showAlert("새로운 포럼이 성공적으로 생성되었습니다.", "생성 완료");
      setIsAddingForum(false);
      setSelectedModerator(null);
    } catch (e: any) {
      await showAlert(`Error: ${e.message}`, "Error");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Forum Management</h1>
          <p className="text-sm text-gray-500 font-semibold mt-1">Monitor active discussions, force actions, or replay history.</p>
        </div>
        <Button onClick={() => setIsSelectingModerator(true)} className="bg-brand text-white hover:bg-brand-hover shadow-lg shadow-brand/20">
          <Plus size={16} className="mr-2" />
          Create New Forum
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 font-medium">Loading forums...</div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden pb-4 overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-gray-50/50 text-gray-500 font-semibold uppercase tracking-wider text-[10px] border-b border-gray-100">
              <tr>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Topic & Date</th>
                <th className="px-6 py-4">Staff / Moderator</th>
                <th className="px-6 py-4 text-right">Moderation Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {forums.map((f) => {
                const isActive = f.status === "active";
                return (
                  <tr key={f.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4">
                      {isActive ? (
                        <div className="flex items-center gap-1.5 rounded-full bg-green-500/10 border border-green-500/20 px-2.5 py-1 w-max">
                          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                          <span className="text-[10px] font-black text-green-700 uppercase tracking-widest">Active</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 rounded-full bg-gray-100 border border-gray-200 px-2.5 py-1 w-max">
                          <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                          <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Closed</span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <p className="font-bold text-gray-900 truncate max-w-sm" title={f.topic}>{f.topic}</p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase">
                          {f.createdAt?.toDate ? f.createdAt.toDate().toLocaleString() : "Unknown"}
                          {" "}• {f.count} Countries
                          {f.forumType && ` • Type: ${f.forumType.toUpperCase()}`}
                        </p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-[10px] font-black text-gray-400">
                          {f.moderatorName?.charAt(0).toUpperCase() || "?"}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-gray-900 truncate max-w-[120px]">{f.moderatorName || "Unknown"}</p>
                          <p className="text-[9px] font-mono text-gray-400">{f.createdBy?.substring(0, 8) || "N/A"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditClick(f)}
                          className="h-8 w-8 p-0 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-brand"
                          title="Edit Topic"
                        >
                          <Edit2 size={14} />
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditCountriesClick(f)}
                          className="h-8 w-8 p-0 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-purple-600"
                          title="Manage Countries & AI"
                        >
                          <Users2 size={14} />
                        </Button>

                        {isActive && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleForceClose(f.id)}
                            className="h-8 w-8 p-0 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600"
                            title="Force Close Session"
                          >
                            <StopCircle size={14} />
                          </Button>
                        )}

                        {/* 관리자 참가/관전액션 */}
                        <Link href={`/forum/${f.id}?admin=1`} passHref>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-8 gap-1.5 px-3 rounded-lg text-[10px] font-bold tracking-wider uppercase shadow-sm border ${isActive ? "bg-brand/5 border-brand/20 text-brand hover:bg-brand hover:text-white" : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                              }`}
                          >
                            {isActive ? <Shield size={12} strokeWidth={2.5} /> : <Eye size={12} strokeWidth={2.5} />}
                            {isActive ? "Observe" : "Replay"}
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {forums.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-500 italic">No forums found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Title Modal */}
      <Modal isOpen={!!editingForum} onClose={() => setEditingForum(null)} title="Edit Forum">
        <div className="space-y-5">
          <Input
            label="Forum Topic"
            placeholder="Enter new topic title"
            value={forumTopic}
            onChange={(e) => setForumTopic(e.target.value)}
          />
          <Input
            label="Subtopic (optional)"
            placeholder="Narrow the focus for this session"
            value={forumSubtopic}
            onChange={(e) => setForumSubtopic(e.target.value)}
          />
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setEditingForum(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit}>Save Changes</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Countries & AI Modal */}
      <Modal isOpen={!!editingCountries} onClose={() => setEditingCountries(null)} title="Manage Countries & AI">
        <div className="space-y-6">

          {/* Capacity Slider */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Forum Capacity</h3>
            <div className="rounded-xl border border-gray-100 bg-gray-50/30 px-6 py-4">
              <div className="flex items-end justify-between mb-3">
                <span className="text-[10px] font-bold text-gray-400">Min: 7</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-4xl font-black text-brand tracking-tighter">{forumCount}</span>
                </div>
                <span className="text-[10px] font-bold text-gray-400">Max: 50</span>
              </div>
              <div className="relative h-2 w-full bg-gray-100 rounded-full">
                <div
                  className="absolute h-full bg-brand rounded-full transition-all"
                  style={{ width: `${((forumCount - 7) / 43) * 100}%` }}
                />
                <input
                  type="range"
                  min="7"
                  max="50"
                  value={forumCount}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setForumCount(val);
                    setForumCountries((prev) => (prev.length > val ? prev.slice(0, val) : prev));
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div
                  className="absolute h-4 w-4 bg-white border-2 border-brand rounded-full top-1/2 -ml-2 -mt-2 pointer-events-none transition-all"
                  style={{ left: `${((forumCount - 7) / 43) * 100}%` }}
                />
              </div>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Participating Countries <span className="text-brand">({forumCountries.length}/{forumCount})</span></h3>
            </div>
            <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto custom-scrollbar pr-2">
              {forumCountries.length === 0 ? <p className="text-sm text-gray-400">No countries assigned.</p> : null}
              {forumCountries.map(c => (
                <div key={c.code} className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-gray-50/50">
                  <div className="flex items-center gap-2">
                    <img src={`https://flagcdn.com/w20/${c.code}.png`} className="w-5 h-4 object-cover rounded shrink-0 shadow-sm" alt={c.name} />
                    <span className="text-sm font-bold text-gray-900">{c.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <span className={`text-[10px] uppercase font-black tracking-widest ${c.isAI ? "text-purple-600" : "text-gray-400"}`}>AI Mode</span>
                      <input type="checkbox" checked={c.isAI || false} onChange={() => handleToggleAI(c.code)} className="accent-purple-600" />
                    </label>
                    <button onClick={() => handleRemoveCountry(c.code)} className="text-gray-400 hover:text-red-500 font-bold ml-2">×</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t border-gray-100">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Add Country</h3>
            <div ref={searchRef} className="relative">
              <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-3 focus-within:border-brand focus-within:bg-white focus-within:ring-4 focus-within:ring-brand/5 transition-all">
                <Search size={14} className="text-gray-400 shrink-0" />
                <input
                  type="text"
                  placeholder={forumCountries.length >= forumCount ? `Maximum ${forumCount} countries reached` : "Search countries to add..."}
                  className="flex-1 text-sm font-medium outline-none bg-transparent"
                  value={countrySearch}
                  onChange={(e) => {
                    setCountrySearch(e.target.value);
                    if (searchRef.current) {
                      const rect = searchRef.current.getBoundingClientRect();
                      setDropUp(window.innerHeight - rect.bottom < 220);
                    }
                    setShowCountryDropdown(true);
                  }}
                  onFocus={() => {
                    if (searchRef.current) {
                      const rect = searchRef.current.getBoundingClientRect();
                      setDropUp(window.innerHeight - rect.bottom < 220);
                    }
                    setShowCountryDropdown(true);
                  }}
                  disabled={forumCountries.length >= forumCount}
                />
                <button
                  type="button"
                  onClick={handleRandomFill}
                  disabled={forumCountries.length >= forumCount}
                  className="flex items-center gap-1.5 rounded-lg bg-brand/10 px-2.5 py-1.5 text-[10px] font-black text-brand hover:bg-brand hover:text-white transition-all uppercase tracking-wider disabled:opacity-30 disabled:pointer-events-none"
                  title="Fill remaining slots randomly"
                >
                  <Shuffle size={12} />
                  Random
                </button>
              </div>

              {showCountryDropdown && (
                <div className={`absolute z-50 w-full max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-xl custom-scrollbar ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
                  {availableDbCountries
                    .filter(c =>
                      c.name.toLowerCase().includes(countrySearch.toLowerCase()) &&
                      !forumCountries.some(fc => fc.code === c.code)
                    )
                    .slice(0, 20)
                    .map((c) => (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => {
                          handleAddCountry(c);
                          setCountrySearch("");
                          setShowCountryDropdown(false);
                        }}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-brand/5 transition-colors"
                      >
                        <img
                          src={`https://flagcdn.com/w40/${c.code}.png`}
                          className="w-5 h-3.5 rounded-sm object-cover shadow-sm border border-black/5"
                          alt={c.name}
                        />
                        <span className="font-medium text-gray-700">{c.name}</span>
                      </button>
                    ))}
                  {availableDbCountries.filter(c => c.name.toLowerCase().includes(countrySearch.toLowerCase()) && !forumCountries.some(fc => fc.code === c.code)).length === 0 && (
                    <div className="px-4 py-3 text-sm text-gray-500 italic text-center">No countries found.</div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setEditingCountries(null)}>Cancel</Button>
            <Button onClick={handleSaveCountries}>Save Settings</Button>
          </div>
        </div>
      </Modal>
      
      <SelectModeratorModal
        isOpen={isSelectingModerator}
        onClose={() => setIsSelectingModerator(false)}
        onSelect={(mod) => {
          setSelectedModerator(mod);
          setIsSelectingModerator(false);
          setIsAddingForum(true);
        }}
      />
      
      <CreateForumModal 
        isOpen={isAddingForum} 
        onClose={() => {
          setIsAddingForum(false);
          setSelectedModerator(null);
        }} 
        onSubmit={handleCreateForum} 
      />

    </div>
  );
}
