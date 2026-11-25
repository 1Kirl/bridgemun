"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, doc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getAllCountryEntries } from "@/lib/countries";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useModal } from "@/context/ModalContext";
import { Edit2, RefreshCw, Search } from "lucide-react";

type DbCountry = {
  id: string;
  name: string;
  code: string;
  politicalAlignment: string;
  diplomaticStance: string;
  additionalPrompt: string;
};

export default function AdminCountriesPage() {
  const [countries, setCountries] = useState<DbCountry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const { showConfirm, showAlert } = useModal();
  
  // Edit State
  const [editingCountry, setEditingCountry] = useState<DbCountry | null>(null);
  const [formData, setFormData] = useState({
    politicalAlignment: "",
    diplomaticStance: "",
    additionalPrompt: ""
  });

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "admin_countries"), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as DbCountry));
      
      // 알파벳 순 정렬
      list.sort((a, b) => a.name.localeCompare(b.name));
      setCountries(list);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const handleSync = async () => {
    const ok = await showConfirm("REST API에서 최신 국가 목록을 불러와 DB와 동기화하시겠습니까? (기존 AI 프롬프트 유지)", "Sync Countries");
    if (!ok) return;

    try {
      setLoading(true);
      const entries = await getAllCountryEntries();
      const batch = writeBatch(db);
      
      // Chunking batches if too many, but Firestore batch limit is 500. Restcountries is ~250.
      entries.forEach((c) => {
        const ref = doc(db, "admin_countries", c.code);
        // We use merge: true so we don't overwrite existing prompts
        batch.set(ref, {
          name: c.name,
          code: c.code,
        }, { merge: true });
      });

      await batch.commit();
      await showAlert("국가 목록 동기화가 완료되었습니다.", "Success");
    } catch (e: any) {
      await showAlert(`Error: ${e.message}`, "Sync Failed");
    } finally {
      setLoading(false);
    }
  };

  const handleEditClick = (c: DbCountry) => {
    setEditingCountry(c);
    setFormData({
      politicalAlignment: c.politicalAlignment || "",
      diplomaticStance: c.diplomaticStance || "",
      additionalPrompt: c.additionalPrompt || "",
    });
  };

  const handleSave = async () => {
    if (!editingCountry) return;
    try {
      const ref = doc(db, "admin_countries", editingCountry.id);
      await updateDoc(ref, formData);
      setEditingCountry(null);
    } catch (e: any) {
      await showAlert(`저장 실패: ${e.message}`, "Error");
    }
  };

  const filtered = countries.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.code.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Country Management</h1>
          <p className="text-sm text-gray-500 font-semibold mt-1">Manage AI representative prompts and diplomatic stances.</p>
        </div>
        <Button onClick={handleSync} variant="secondary" className="gap-2">
          <RefreshCw size={14} className={loading && countries.length === 0 ? "animate-spin" : ""} />
          Sync from API
        </Button>
      </div>

      <div className="flex bg-white rounded-xl shadow-sm border border-gray-100 p-2">
        <Input 
          label=""
          placeholder="Search by country name or code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          icon={<Search size={16} />}
          className="w-full max-w-md border-transparent bg-transparent shadow-none focus:ring-0"
        />
      </div>

      {loading && countries.length === 0 ? (
        <div className="text-center py-12 text-gray-400 font-medium">Loading countries...</div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50/50 text-gray-500 font-semibold uppercase tracking-wider text-[10px] border-b border-gray-100">
              <tr>
                <th className="px-6 py-4">Country</th>
                <th className="px-6 py-4">Political Alignment</th>
                <th className="px-6 py-4">Diplomatic Stance</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-6 overflow-hidden rounded shadow-sm border border-black/5 shrink-0">
                        <img
                          src={`https://flagcdn.com/w40/${c.code}.png`}
                          className="w-full h-full object-cover"
                          alt={c.name}
                        />
                      </div>
                      <div>
                        <p className="font-bold text-gray-900">{c.name}</p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase">{c.code}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs text-gray-600 line-clamp-1 max-w-[200px]">{c.politicalAlignment || <span className="text-gray-300 italic">Not set</span>}</span>
                  </td>
                  <td className="px-6 py-4">
                     <span className="text-xs text-gray-600 line-clamp-1 max-w-[200px]">{c.diplomaticStance || <span className="text-gray-300 italic">Not set</span>}</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Button variant="ghost" size="sm" onClick={() => handleEditClick(c)} className="h-8 px-3 text-brand hover:bg-brand/5">
                      <Edit2 size={14} className="mr-2" /> Edit AI Prompt
                    </Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-500 italic">No countries found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Modal */}
      <Modal isOpen={!!editingCountry} onClose={() => setEditingCountry(null)} title={`Edit AI Profile: ${editingCountry?.name}`}>
        <div className="space-y-5">
          <Input 
            label="Political Alignment" 
            placeholder="e.g. Democratic Republic, Liberal Democracy, Authoritarian..."
            value={formData.politicalAlignment}
            onChange={(e) => setFormData({...formData, politicalAlignment: e.target.value})}
          />
          <Input 
            label="General Diplomatic Stance" 
            placeholder="e.g. Pro-Western, Non-Aligned, Highly cooperative on climate..."
            value={formData.diplomaticStance}
            onChange={(e) => setFormData({...formData, diplomaticStance: e.target.value})}
          />
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-700">Additional Instructions (System Prompt)</label>
            <textarea 
              className="w-full rounded-xl border border-gray-200 bg-gray-50/50 p-4 text-sm font-medium transition-all focus:border-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand/5 min-h-[120px] resize-y"
              placeholder="Enter comprehensive instructions for the AI representative..."
              value={formData.additionalPrompt}
              onChange={(e) => setFormData({...formData, additionalPrompt: e.target.value})}
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setEditingCountry(null)}>Cancel</Button>
            <Button onClick={handleSave}>Save Changes</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
