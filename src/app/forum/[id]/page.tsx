"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { doc, updateDoc, onSnapshot, collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Users2, MessageSquare, LogOut, Clock, Mic, Eye, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import dynamic from "next/dynamic";
import { useAuth } from "@/context/AuthContext";
import { useSpeakQueue, type Speech } from "@/hooks/useSpeakQueue";
import { useAISuggestions, type AISuggestion } from "@/hooks/useAISuggestions";
import { useModal } from "@/context/ModalContext";
import { useToast } from "@/context/ToastContext";
import { CountrySelectModal } from "@/components/forum/CountrySelectModal";
import { SpeakButton } from "@/components/forum/SpeakButton";
import { MotionsPanel } from "@/components/forum/MotionsPanel";
import {
  isForumVotingUnlocked,
  isScheduledEndReached,
  formatScheduledEndLocal,
} from "@/lib/forumSchedule";

const ZoomVideo = dynamic(() => import("@/components/forum/ZoomVideo"), { ssr: false });
const SpeakRequestButton = dynamic(() => import("@/components/forum/SpeakRequestButton"), { ssr: false });
const ModeratorPanel = dynamic(() => import("@/components/forum/ModeratorPanel"), { ssr: false });

interface CountryEntry {
  name: string;
  code: string;
  isAI?: boolean;
}

interface ForumData {
  topic: string;
  subtopic?: string;
  count: number;
  date: string;
  time: string;
  forumType?: string;
  countries?: CountryEntry[];
  createdBy?: string;
  moderatorName?: string;
  createdAt?: any;
  status?: string;
  votingOpen?: boolean;
  ballotsFinalized?: boolean;
}

interface Participant {
  id?: string;
  userId: string;
  userName: string;
  country: CountryEntry;
  online?: boolean;
}

export default function MeetingRoom() {
  const params = useParams();
  const forumId =
    typeof params.id === "string"
      ? params.id
      : Array.isArray(params.id)
        ? params.id[0] ?? ""
        : "";
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAdminObserver = searchParams.get("admin") === "1";
  
  const [forum, setForum] = useState<ForumData | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const { user } = useAuth();
  const {
    requests,
    speeches,
    requestToSpeak,
    approveRequest,
    rejectRequest,
    submitSpeech,
    updateSpeech,
  } = useSpeakQueue(forumId);
  const {
    suggestions,
    loading: aiLoading,
    loadingCountryCode: aiLoadingCountryCode,
    generateSuggestion,
    publishSuggestion,
    rejectSuggestion,
  } = useAISuggestions(forumId);
  const [aiPickLoadingId, setAiPickLoadingId] = useState<string | null>(null);
  const { showAlert, showConfirm } = useModal();
  const { showToast } = useToast();

  // 참가자 관리
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [myCountry, setMyCountry] = useState<CountryEntry | null>(null);
  const [entered, setEntered] = useState(false);
  const [editSpeechId, setEditSpeechId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const isModerator = !!user && !!forum?.createdBy && user.uid === forum.createdBy && !isAdminObserver;

  const alreadyJoined =
    !!user && participants.some((p) => p.userId === user.uid);

  const prevRequestStatusRef = useRef<Record<string, string>>({});
  const voteRedirectPromptedRef = useRef(false);

  useEffect(() => {
    if (!isModerator) return;
    for (const r of requests) {
      const prev = prevRequestStatusRef.current[r.id];
      if (prev === "approved" && r.status === "done") {
        showToast(`${r.userName} ended their speech`);
      }
      prevRequestStatusRef.current[r.id] = r.status;
    }
  }, [requests, isModerator, showToast]);

  // 타이머 로직
  useEffect(() => {
    if (!forum?.createdAt || !forum?.time) return;

    const durationMin = parseInt(String(forum.time), 10);
    const durationSeconds =
      Number.isFinite(durationMin) && durationMin > 0 ? durationMin * 60 : 3600;
    const created = forum.createdAt?.toDate?.();
    const startTimestamp =
      created instanceof Date && !Number.isNaN(created.getTime())
        ? created.getTime()
        : Date.now();

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsedSeconds = Math.floor((now - startTimestamp) / 1000);
      const remaining = Math.max(0, durationSeconds - elapsedSeconds);

      setTimeLeft(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        if (isModerator) {
          void showAlert(
            "The forum duration has ended.",
            "Session Timer",
          ).catch(() => {});
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [forum?.createdAt, forum?.time, isModerator, showAlert]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEndSession = async () => {
    const isConfirmed = await showConfirm(
      "Are you sure you want to end this forum session for everyone?",
      "End Forum"
    );
    if (!isConfirmed) return;

    try {
      const docRef = doc(db, "forums", forumId);
      await updateDoc(docRef, { status: "closed", votingOpen: false });

      const votingReady = forum ? isScheduledEndReached(forum) : false;
      if (!votingReady) {
        const when = forum ? formatScheduledEndLocal(forum) : null;
        await showAlert(
          when
            ? `Voting will open after the scheduled end time (${when}). You can return from My forums or the forum link later.`
            : "Voting will open after the scheduled session duration has elapsed.",
          "Session ended early",
        );
        router.push("/");
        return;
      }

      const goVote = await showConfirm(
        "The session is closed for everyone. Go to the voting page?",
        "Voting",
      );
      if (goVote) router.push(`/forum/${forumId}/vote`);
      else router.push("/");
    } catch (err) {
      console.error("Error ending session:", err);
    }
  };

  // 참가자: 종료 감지 시 투표 페이지로 안내 (모더·옵저버 제외, 1회) — 예정 시간 경과 후에만 투표 유도
  useEffect(() => {
    if (forum?.status !== "closed") {
      voteRedirectPromptedRef.current = false;
      return;
    }
    if (isAdminObserver || isModerator) return;
    if (voteRedirectPromptedRef.current) return;
    if (!forum || !isForumVotingUnlocked(forum)) {
      voteRedirectPromptedRef.current = true;
      void (async () => {
        const when = formatScheduledEndLocal(forum);
        await showAlert(
          when
            ? `This session ended before the scheduled time. Voting opens at ${when}.`
            : "This session ended before the scheduled time. Voting will open after the planned duration.",
          "Session ended early",
        );
        router.push("/");
      })();
      return;
    }
    voteRedirectPromptedRef.current = true;

    void (async () => {
      try {
        const go = await showConfirm(
          "The forum session has ended. Go to the voting page?",
          "Session Ended",
        );
        if (go) router.push(`/forum/${forumId}/vote`);
        else router.push("/");
      } catch {
        router.push("/");
      }
    })();
  }, [forum, forum?.status, isAdminObserver, isModerator, forumId, router, showConfirm, showAlert]);
  const myRequest = requests.find(
    (r) => r.userId === user?.uid && (r.status === 'pending' || r.status === 'approved'),
  );
  const approvedRequest = requests.find((r) => r.status === 'approved');
  const canSpeak = isModerator || myRequest?.status === 'approved';
  const speakerName = approvedRequest?.userName;
  const emptyCountries = (forum?.countries ?? []).filter((country) => {
    const alreadySelected = participants.some((p) => p.country.code === country.code);
    return !alreadySelected;
  });
  const aiCandidateCountries = emptyCountries.filter((country) => country.isAI === true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDragStart = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    setDragging(true);
    const startX = e.pageX;
    const startScroll = el.scrollLeft;
    const onMove = (ev: MouseEvent) => {
      el.scrollLeft = startScroll - (ev.pageX - startX) * 1.5;
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    if (!forumId) return;
    const docRef = doc(db, "forums", forumId);
    const unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists()) {
          setForum(docSnap.data() as ForumData);
        }
      },
      (err) => {
        console.error("Forum document listener:", err);
      },
    );

    return () => unsubscribe();
  }, [forumId]);

  // 참가자 목록 실시간 구독
  useEffect(() => {
    if (!forumId) return;
    const colRef = collection(db, "forums", forumId, "participants");
    const unsubscribe = onSnapshot(
      colRef,
      (snap) => {
        const list: Participant[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Participant, "id">),
        }));
        setParticipants(list);

        // 내가 이미 등록되어 있으면 자동 입장
        if (user) {
          const me = list.find((p) => p.userId === user.uid);
          if (me) {
            setMyCountry(me.country);
            setEntered(true);
          }
        }
      },
      (err) => {
        console.error("Participants listener:", err);
      },
    );
    return () => unsubscribe();
  }, [forumId, user]);

  // 진행자 및 옵저버는 자동 입장
  useEffect(() => {
    if (isModerator || isAdminObserver) setEntered(true);
  }, [isModerator, isAdminObserver]);

  // 내 participant 문서 ID를 ref로 추적 (dependency 루프 방지)
  const myParticipantIdRef = useRef<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const me = participants.find((p) => p.userId === user?.uid);
    myParticipantIdRef.current = me?.id ?? null;
  }, [participants, user]);

  // 온라인 상태 관리: 입장 시 online: true, 이탈 시 online: false
  useEffect(() => {
    if (!forumId || !user || !entered) return;

    // 약간의 딜레이로 participant 문서가 생성된 후 실행
    const timer = setTimeout(() => {
      const docId = myParticipantIdRef.current;
      if (!docId) return;

      const participantRef = doc(db, "forums", forumId, "participants", docId);
      void updateDoc(participantRef, { online: true }).catch(() => {});

      const goOffline = () => {
        void updateDoc(participantRef, { online: false }).catch(() => {});
      };

      window.addEventListener("beforeunload", goOffline);
      cleanupRef.current = () => {
        window.removeEventListener("beforeunload", goOffline);
        goOffline();
      };
    }, 500);

    return () => {
      clearTimeout(timer);
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [forumId, user?.uid, entered]); // participants 제외

  // 국가 선택 후 입장 처리
  const handleCountrySelect = async (country: CountryEntry) => {
    if (!user || !forumId) return;
    if (forum?.status === "closed") {
      await showAlert(
        "This session has ended. New participants cannot join.",
        "Forum Closed",
      );
      return;
    }
    try {
      await addDoc(collection(db, "forums", forumId, "participants"), {
        userId: user.uid,
        userName: user.displayName || user.email || "Anonymous",
        country,
        online: true,
        joinedAt: serverTimestamp(),
      });
      setMyCountry(country);
      setEntered(true);
    } catch (e) {
      console.error("Error joining forum:", e);
    }
  };

  const resolveSpeechCountry = (speech: Speech) => {
    if (speech.country) return speech.country;
    const p = participants.find((x) => x.userId === speech.userId);
    return p?.country;
  };

  const handleGenerateAISuggestion = async (countryCode: string) => {
    if (!forum) return;
    const country = (forum.countries ?? []).find((c) => c.code === countryCode);
    if (!country) return;

    try {
      await generateSuggestion({
        forumId,
        topic: forum.topic,
        subtopic: forum.subtopic,
        countryCode: country.code,
        countryName: country.name,
        roleProfile: "",
        userId: user?.uid,
        recentSpeeches: speeches.map((s) => {
          const sc = resolveSpeechCountry(s);
          return {
            userName: s.userName,
            text: s.text,
            sourceType: s.sourceType || "human",
            countryName: sc?.name,
            countryCode: sc?.code,
          };
        }),
      });
    } catch (error) {
      await showAlert(`AI generation failed: ${String(error)}`, "AI Error");
    }
  };

  const handlePublishAISuggestion = async (
    suggestion: AISuggestion,
    stance: "pro" | "con",
  ) => {
    try {
      await publishSuggestion(suggestion, stance, user?.uid);
    } catch (error) {
      await showAlert(`Failed to publish AI speech: ${String(error)}`, "Publish Error");
    }
  };

  const handleAutoPublishAISuggestion = async (suggestion: AISuggestion) => {
    if (!forum) return;
    const pro = suggestion.candidates.find((c) => c.stance === "pro");
    const con = suggestion.candidates.find((c) => c.stance === "con");
    if (!pro?.text?.trim() || !con?.text?.trim()) {
      await showAlert("PRO and CON texts are required for AI to choose.", "AI choice");
      return;
    }
    setAiPickLoadingId(suggestion.id);
    try {
      const res = await fetch("/api/ai/pick-stance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: forum.topic,
          subtopic: forum.subtopic,
          countryName: suggestion.countryName,
          pro: { text: pro.text, rationale: pro.rationale },
          con: { text: con.text, rationale: con.rationale },
        }),
      });
      const data = (await res.json()) as { error?: string; stance?: string };
      if (!res.ok) throw new Error(data?.error || "AI could not choose a stance");
      const stance = data.stance === "con" ? "con" : "pro";
      await publishSuggestion(suggestion, stance, user?.uid);
    } catch (error) {
      await showAlert(String(error), "AI choice");
    } finally {
      setAiPickLoadingId(null);
    }
  };

  const handleRejectAISuggestion = async (suggestionId: string) => {
    try {
      await rejectSuggestion(suggestionId, user?.uid);
    } catch (error) {
      await showAlert(`Failed to reject AI suggestion: ${String(error)}`, "Reject Error");
    }
  };

  const handleToggleCountryAI = async (countryCode: string, enabled: boolean) => {
    if (!forum || !isModerator) return;
    const nextCountries = (forum.countries ?? []).map((country) =>
      country.code === countryCode ? { ...country, isAI: enabled } : country,
    );
    try {
      await updateDoc(doc(db, "forums", forumId), {
        countries: nextCountries,
      });
    } catch (error) {
      await showAlert(`Failed to update AI country setting: ${String(error)}`, "Update Error");
    }
  };

  const handleVotingOpenChange = async (open: boolean) => {
    if (!isModerator) return;
    try {
      await updateDoc(doc(db, "forums", forumId), { votingOpen: open });
    } catch (error) {
      await showAlert(`Could not update voting: ${String(error)}`, "Update Error");
    }
  };

  const canEditSpeech = (speech: Speech) => {
    if (!user) return false;
    if (isModerator) return true;
    if (speech.sourceType === "ai") return false;
    return speech.userId === user.uid;
  };

  const saveEditSpeech = async () => {
    if (!editSpeechId) return;
    try {
      await updateSpeech(editSpeechId, editDraft);
      setEditSpeechId(null);
      setEditDraft("");
    } catch (e) {
      await showAlert(`Could not save edit: ${String(e)}`, "Edit Error");
    }
  };

  if (!forum) return <div className="flex h-screen items-center justify-center bg-[#f1f5f9] text-gray-400">Loading Session...</div>;

  if (
    forum.status === "closed" &&
    !isModerator &&
    !isAdminObserver &&
    !alreadyJoined
  ) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-[#f1f5f9] px-6 text-center">
        <p className="text-lg font-bold text-gray-800">This forum session has ended.</p>
        <p className="text-sm text-gray-500">New participants can no longer join.</p>
        <Button onClick={() => router.push("/")}>Back to Home</Button>
      </div>
    );
  }

  // 참가자: 국가 선택 전이면 모달 표시
  if (!entered && !isModerator && !isAdminObserver) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f1f5f9]">
        <CountrySelectModal
          isOpen={true}
          countries={forum.countries ?? fallbackCountries}
          participants={participants}
          onSelect={handleCountrySelect}
          onDismiss={() => router.push("/")}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#f1f5f9] overflow-hidden">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between bg-white px-6 border-b border-gray-200 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-xs font-black text-white uppercase shadow-lg shadow-brand/20">UN</div>
            <span className="font-bold text-brand tracking-tight text-lg">MUN Platform</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {myCountry && (
            <div className="flex items-center gap-1.5 rounded-full bg-white border border-gray-200 px-3 py-1">
              <img src={`https://flagcdn.com/w40/${myCountry.code}.png`} className="w-4 h-3 rounded-sm object-cover" alt={myCountry.name} />
              <span className="text-[10px] font-black text-gray-700 uppercase tracking-wider">{myCountry.name}</span>
              {(forum.countries ?? []).find((c) => c.code === myCountry.code)?.isAI && (
                <span className="rounded-md bg-purple-600 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-white">
                  AI
                </span>
              )}
            </div>
          )}
          {isAdminObserver ? (
            <div className="flex items-center gap-1.5 rounded-full bg-slate-800 border border-slate-700 px-3 py-1 shadow-lg shadow-slate-900/20">
              <Eye size={12} className="text-white" />
              <span className="text-[10px] font-black text-white uppercase tracking-widest">Observer</span>
            </div>
          ) : canSpeak ? (
            <div className="flex items-center gap-1.5 rounded-full bg-red-500 border border-red-600 px-3 py-1 shadow-lg shadow-red-500/30">
              <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              <span className="text-[10px] font-black text-white uppercase tracking-widest">On Air</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-full bg-brand/5 border border-brand/10 px-3 py-1">
              <div className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
              <span className="text-[10px] font-bold text-brand uppercase tracking-widest">{isModerator ? "Moderator" : "Participant"}</span>
            </div>
          )}
          <button onClick={() => router.push("/")} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 transition-all">
            <LogOut size={14} />
            Log Out
          </button>
        </div>
      </header>

      <section className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-6 py-3 shadow-sm">
        <span className="rounded-lg bg-brand-light px-3.5 py-2 text-[11px] font-black uppercase tracking-[0.1em] text-brand border border-brand/10 shrink-0">
          Current Agenda
        </span>
        <div className="min-w-0">
          <span className="block text-2xl font-black leading-tight tracking-tight text-gray-900 truncate md:text-3xl">
            {forum.topic}
          </span>
          {forum.subtopic ? (
            <span className="mt-0.5 block text-sm font-bold text-gray-500 truncate md:text-base">
              {forum.subtopic}
            </span>
          ) : null}
        </div>
      </section>

      <main className="flex min-h-0 flex-1 flex-col gap-5 bg-[#f8fafc] p-5">
        <div className="flex min-h-0 flex-1 gap-5">
          {/* Dashboard Left */}
          <div className="flex w-[420px] shrink-0 flex-col gap-5 min-h-0">
            <div className="rounded-2xl border border-transparent bg-brand p-5 text-center text-white shadow-xl shadow-brand/20 flex flex-col items-center justify-center">
              <div className="flex items-center justify-center gap-2 opacity-80 mb-1">
                <Clock size={16} />
                <span className="text-[10px] font-bold uppercase tracking-widest">Remaining</span>
              </div>
              <div className={`text-[56px] font-black leading-none tracking-tighter ${timeLeft < 60 ? 'text-red-300 animate-pulse' : ''}`}>
                {formatTime(timeLeft)}
              </div>
            </div>

            <div className={`relative flex-1 overflow-hidden rounded-[3rem] bg-[#020617] shadow-inner ring-1 transition-all duration-500 ${canSpeak && !isModerator ? "ring-red-500/50" : "ring-white/10"}`}>
              {forum.status === "closed" ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 bg-gray-900 text-gray-400">
                   <Eye size={40} className="opacity-20" />
                   <p className="text-xs font-bold uppercase tracking-widest">Replay Mode - Video Disabled</p>
                </div>
              ) : (
                <ZoomVideo
                  forumId={forumId}
                  onLeave={() => router.push("/")}
                  onConfirmLeave={async () =>
                    showConfirm(
                      "Leave the video session and return to the home page?",
                      "Return to main",
                    )
                  }
                  videoSdkRole={isModerator ? 1 : 0}
                  canSpeak={canSpeak && !isAdminObserver}
                  speakerName={speakerName}
                  moderatorIdentity={forum.createdBy}
                  moderatorName={forum.moderatorName}
                  micMuted={isMuted}
                  onMicMutedChange={setIsMuted}
                />
              )}
              {(canSpeak && !isModerator && !isAdminObserver && forum.status !== "closed") && (
                <div className="absolute left-6 top-6 flex items-center justify-center">
                  {isVoiceActive && (
                    <>
                      <div className="absolute h-10 w-10 animate-ping rounded-full bg-green-500/40" />
                      <div className="absolute h-14 w-14 animate-pulse rounded-full bg-green-500/20" />
                    </>
                  )}
                  <div className={`relative flex h-10 w-10 items-center justify-center rounded-full shadow-xl transition-all duration-300 ${isVoiceActive ? "scale-110 bg-green-500" : "bg-gray-800/80"}`}>
                    <Mic size={18} className={isVoiceActive ? "text-white" : "text-gray-400"} />
                  </div>
                </div>
              )}
            </div>

            {(!isModerator && !isAdminObserver) && (
              <SpeakRequestButton
                userId={user?.uid ?? ""}
                userName={user?.displayName || user?.email || "Anonymous"}
                requests={requests}
                onRequest={() => requestToSpeak(user?.uid ?? "", user?.displayName || user?.email || "Anonymous")}
                onEndSpeech={(reqId, text) =>
                  submitSpeech(
                    reqId,
                    user?.uid ?? "",
                    user?.displayName || user?.email || "Anonymous",
                    text,
                    myCountry ?? undefined,
                  )
                }
                isMuted={isMuted}
                onVoiceActivity={setIsVoiceActive}
              />
            )}
          </div>

          {/* Dashboard Right — 모더레이터 패널·대표단·피드를 한 열에서 통째로 세로 스크롤 */}
          <div className="custom-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden overscroll-y-contain pr-1">
            {/* 방장 전용 패널 */}
            {isModerator && (
              <ModeratorPanel
                requests={requests}
                onApprove={approveRequest}
                onReject={rejectRequest}
                onEndSession={handleEndSession}
                emptyCountries={emptyCountries}
                aiSuggestions={suggestions}
                aiLoading={aiLoading}
                loadingCountryCode={aiLoadingCountryCode}
                aiPickLoadingId={aiPickLoadingId}
                onGenerateAISuggestion={handleGenerateAISuggestion}
                onPublishAISuggestion={handlePublishAISuggestion}
                onAutoPublishAISuggestion={handleAutoPublishAISuggestion}
                onRejectAISuggestion={handleRejectAISuggestion}
                onToggleCountryAI={handleToggleCountryAI}
                forumStatus={forum.status}
                votingOpen={forum.votingOpen}
                ballotsFinalized={forum.ballotsFinalized}
                onVotingOpenChange={handleVotingOpenChange}
              />
            )}
            {/* Participating Countries (Standard Scrollable) */}
            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm shrink-0 min-w-0 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users2 size={16} className="text-brand" />
                  <h3 className="text-[11px] font-black text-gray-900 uppercase tracking-[0.2em]">
                    Delegations ({forum.countries?.length ?? forum.count})
                    <span className="ml-1 font-bold text-gray-400">+ 1 Moderator</span>
                    {forum.forumType === "g7" && <span className="ml-1.5 text-brand">G7</span>}
                  </h3>
                </div>
              </div>
              <div
                ref={scrollRef}
                onMouseDown={onDragStart}
                className={`flex gap-2.5 overflow-x-auto pb-1 custom-scrollbar min-w-0 w-full ${dragging ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
              >
                {(forum.countries ?? fallbackCountries).map((c) => {
                  const assigned = participants.find((p) => p.country.code === c.code);
                  const isMe = assigned?.userId === user?.uid;
                  const isOnline = assigned?.online === true;
                  return (
                    <div
                      key={c.code}
                      className={`flex min-w-[140px] items-center gap-2.5 rounded-xl border px-3 py-2 shrink-0 select-none transition-all duration-300 ${
                        isMe
                          ? "border-brand/40 bg-brand/5 ring-2 ring-brand/20 shadow-md shadow-brand/10"
                          : assigned && isOnline
                            ? "border-green-200 bg-green-50/50 shadow-sm"
                            : assigned && !isOnline
                              ? "border-slate-200 bg-slate-50/50"
                              : "border-dashed border-slate-200 bg-slate-50/30"
                      }`}
                    >
                      <div className={`w-8 h-6 overflow-hidden rounded shadow-sm border shrink-0 transition-all duration-300 ${
                        assigned && isOnline ? "border-black/5 grayscale-0" : assigned ? "border-black/5 grayscale-[50%]" : "border-black/5 grayscale"
                      }`}>
                        <img
                          src={`https://flagcdn.com/w40/${c.code}.png`}
                          className="w-full h-full object-cover"
                          alt={c.name}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <p className={`text-[11px] font-black truncate uppercase tracking-tighter transition-colors duration-300 ${
                            assigned && isOnline ? "text-slate-900" : assigned ? "text-slate-500" : "text-slate-400"
                          }`}>{c.name}</p>
                          {c.isAI && (
                            <span className="shrink-0 rounded bg-purple-600 px-1 py-0.5 text-[7px] font-black uppercase tracking-wider text-white">
                              AI
                            </span>
                          )}
                        </div>
                        <p className={`text-[9px] font-bold truncate tracking-tight ${
                          isMe ? "text-brand" : assigned && isOnline ? "text-green-600" : assigned ? "text-slate-400" : "text-slate-300"
                        }`}>
                          {assigned ? (isMe ? "You" : assigned.userName) : "Waiting..."}
                        </p>
                      </div>
                      {assigned && (
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-300 ${
                          isMe ? "bg-brand" : isOnline ? "bg-green-500" : "bg-slate-300"
                        }`} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 투표(Motions) — 모더레이터가 안건 생성, 참가자 투표 (QA2 #1) */}
            {!isAdminObserver && (
              <MotionsPanel
                forumId={forumId}
                isModerator={isModerator}
                userId={user?.uid ?? ""}
                userName={user?.displayName || user?.email || "Anonymous"}
              />
            )}

            {/* Discussion Feed — 본문은 부모 열 스크롤에 맡김 (이중 스크롤 방지) */}
            <div className="flex flex-col rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <div className="mb-4 flex shrink-0 items-center justify-between">
                <div className="flex items-center gap-3">
                  <MessageSquare size={20} className="text-brand" />
                  <h2 className="text-[13px] font-black uppercase tracking-[0.25em] text-gray-900">
                    Global Discussion Feed
                  </h2>
                </div>
              </div>
              <div className="space-y-4 pr-1">
                {speeches.length === 0 ? (
                  <div className="flex min-h-[12rem] flex-col items-center justify-center gap-2 text-gray-300">
                    <MessageSquare size={32} className="opacity-30" />
                    <p className="text-sm font-semibold">No speeches yet</p>
                  </div>
                ) : (
                  speeches.map((speech) => {
                    const sc = resolveSpeechCountry(speech);
                    const isAI = speech.sourceType === "ai";
                    const pillLabel = isAI && sc ? "AI" : speech.userName;
                    return (
                      <div key={speech.id} className="group flex flex-col gap-2 pl-1 animate-in slide-in-from-bottom-2 duration-400 fade-in">
                        <div className="flex flex-wrap items-center gap-2">
                          {sc && (
                            <img
                              src={`https://flagcdn.com/w40/${sc.code}.png`}
                              alt=""
                              className="h-3.5 w-5 rounded-sm border border-black/5 object-cover shadow-sm"
                            />
                          )}
                          {sc && (
                            <span className="text-[10px] font-black uppercase tracking-tight text-gray-600">
                              {sc.name}
                            </span>
                          )}
                          <span
                            className={`rounded-md px-2 py-0.5 text-[9px] font-black uppercase shadow-lg ring-2 text-white ${
                              isAI
                                ? "bg-purple-600 ring-purple-200"
                                : "bg-brand ring-brand/5"
                            }`}
                          >
                            {pillLabel}
                          </span>
                          {isAI && <SpeakButton text={speech.text} />}
                          {speech.editedAt?.toDate && (
                            <span className="text-[8px] font-bold uppercase tracking-wide text-amber-600">Edited</span>
                          )}
                          {speech.createdAt?.toDate && (
                            <span className="text-[9px] font-bold text-gray-400">
                              {speech.createdAt.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          )}
                          {canEditSpeech(speech) && editSpeechId !== speech.id && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditSpeechId(speech.id);
                                setEditDraft(speech.text);
                              }}
                              className="ml-auto flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[9px] font-black uppercase tracking-wider text-gray-500 opacity-0 transition-opacity hover:border-brand/30 hover:text-brand group-hover:opacity-100"
                            >
                              <Pencil size={10} />
                              Edit
                            </button>
                          )}
                        </div>
                        {editSpeechId === speech.id ? (
                          <div className="flex flex-col gap-2 rounded-xl border border-brand/30 bg-white p-3 shadow-sm">
                            <textarea
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              className="min-h-[100px] w-full resize-y rounded-lg border border-gray-200 p-3 text-sm text-gray-800 outline-none focus:border-brand/40"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditSpeechId(null);
                                  setEditDraft("");
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-[10px] font-bold text-gray-600 hover:bg-gray-50"
                              >
                                <X size={12} />
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => void saveEditSpeech()}
                                className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white hover:bg-brand-hover"
                              >
                                <Check size={12} />
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            className={`select-text cursor-text rounded-xl border px-5 py-3 text-sm leading-relaxed shadow-sm transition-all group-hover:shadow-md md:text-[13px] ${
                              speech.sourceType === "ai"
                                ? "border-purple-100 bg-purple-50/60 text-purple-900"
                                : "border-slate-100/40 bg-slate-50/40 text-slate-700"
                            }`}
                          >
                            {speech.text}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}


/** 기존 포럼(countries 필드 없음) 호환용 폴백 */
const fallbackCountries: CountryEntry[] = [
    { name: "USA", code: "us" }, { name: "China", code: "cn" }, { name: "UK", code: "gb" }, { name: "France", code: "fr" },
    { name: "Germany", code: "de" }, { name: "Japan", code: "jp" }, { name: "Korea", code: "kr" }, { name: "Canada", code: "ca" }
];
