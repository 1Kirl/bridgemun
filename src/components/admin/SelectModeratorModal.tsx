import React, { useState, useEffect, useRef } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Search, Shield, X, ArrowRight } from "lucide-react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";

interface SelectModeratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (user: any) => void;
}

export const SelectModeratorModal = ({ isOpen, onClose, onSelect }: SelectModeratorModalProps) => {
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);
  const [selectedModerator, setSelectedModerator] = useState<any | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const userSearchRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);

  // 유저 목록 로드
  useEffect(() => {
    if (isOpen && availableUsers.length === 0) {
      const fetchUsers = async () => {
        setLoading(true);
        try {
          const q = query(collection(db, "users"), orderBy("displayName", "asc"));
          const snap = await getDocs(q);
          const usersList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setAvailableUsers(usersList);
        } catch (e) {
          console.error("Error fetching users:", e);
          setAvailableUsers([]);
        } finally {
          setLoading(false);
        }
      };
      fetchUsers();
    }
  }, [isOpen, availableUsers.length]);

  // 유저 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userSearchRef.current && !userSearchRef.current.contains(e.target as Node)) {
        setShowUserDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // 초기화
  useEffect(() => {
    if (!isOpen) {
      setSelectedModerator(null);
      setUserSearch("");
    }
  }, [isOpen]);

  const handleContinue = () => {
    if (selectedModerator) {
      onSelect(selectedModerator);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Assign Moderator">
      <div className="flex flex-col gap-6">
        <div className="space-y-1">
          <p className="text-sm text-gray-500 font-medium">Step 1: Choose who will host this forum session.</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-bold text-gray-700">
              <Shield size={16} className="text-brand" />
              Staff / Moderator
            </label>
            <div ref={userSearchRef} className="relative">
              {!selectedModerator ? (
                <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/30 px-4 py-3 focus-within:border-brand focus-within:bg-white focus-within:ring-4 focus-within:ring-brand/5 transition-all">
                  <Search size={14} className="text-gray-400 shrink-0" />
                  <input
                    type="text"
                    placeholder="Search by name or email..."
                    className="flex-1 text-sm font-medium outline-none bg-transparent"
                    value={userSearch}
                    onChange={(e) => {
                      setUserSearch(e.target.value);
                      setShowUserDropdown(true);
                    }}
                    onFocus={() => setShowUserDropdown(true)}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-brand/20 bg-brand/5 px-4 py-3.5 shadow-sm">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-xs font-black text-white shrink-0 shadow-lg shadow-brand/10">
                      {selectedModerator.displayName?.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-black text-brand truncate leading-none mb-1">{selectedModerator.displayName}</p>
                      <p className="text-[10px] font-bold text-brand/60 truncate">{selectedModerator.email}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedModerator(null);
                      setUserSearch("");
                    }}
                    className="h-8 w-8 flex items-center justify-center bg-white border border-brand/10 rounded-lg hover:bg-brand/10 transition-colors text-brand"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}

              {showUserDropdown && userSearch && (
                <div className="absolute bottom-full mb-2 z-[110] w-full max-h-52 overflow-y-auto rounded-xl border border-gray-100 bg-white shadow-2xl custom-scrollbar animate-in fade-in slide-in-from-bottom-2 duration-200">
                  {availableUsers
                    .filter(u => 
                      u.displayName?.toLowerCase().includes(userSearch.toLowerCase()) || 
                      u.email?.toLowerCase().includes(userSearch.toLowerCase())
                    )
                    .map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          setSelectedModerator(u);
                          setShowUserDropdown(false);
                          setUserSearch("");
                        }}
                        className="flex w-full flex-col px-4 py-3 text-left hover:bg-brand/5 transition-colors border-b border-gray-50 last:border-0"
                      >
                        <span className="text-sm font-black text-gray-700 leading-none mb-1">{u.displayName}</span>
                        <span className="text-[10px] text-gray-400 font-bold">{u.email}</span>
                      </button>
                    ))}
                  {availableUsers.filter(u => u.displayName?.toLowerCase().includes(userSearch.toLowerCase()) || u.email?.toLowerCase().includes(userSearch.toLowerCase())).length === 0 && (
                    <div className="px-4 py-8 text-center bg-gray-50/50 rounded-b-xl">
                      <Shield size={24} className="mx-auto text-gray-200 mb-2" />
                      <p className="text-xs text-gray-400 font-bold italic">No matching users found</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <Button
          size="lg"
          onClick={handleContinue}
          disabled={!selectedModerator}
          className="w-full justify-center gap-2 bg-brand text-white hover:bg-brand-hover shadow-xl shadow-brand/20 py-6 rounded-xl transition-all active:scale-95 disabled:grayscale"
        >
          <span className="text-base font-black">Continue to Forum Details</span>
          <ArrowRight size={20} strokeWidth={3} />
        </Button>
      </div>
    </Modal>
  );
};
