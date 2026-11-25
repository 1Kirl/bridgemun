'use client';

import { useEffect, useRef, useState } from 'react';
import { Hand, Clock, Square, Mic } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { SpeakRequest } from '@/hooks/useSpeakQueue';

type Props = {
  userId: string;
  userName: string;
  requests: SpeakRequest[];
  onRequest: () => void;
  onEndSpeech: (requestId: string, text: string) => void;
  isMuted: boolean;
  onVoiceActivity?: (active: boolean) => void;
};

export default function SpeakRequestButton({
  userId,
  userName,
  requests,
  onRequest,
  onEndSpeech,
  isMuted,
  onVoiceActivity,
}: Props) {
  const myRequest = requests.find(
    (r) => r.userId === userId && (r.status === 'pending' || r.status === 'approved'),
  );

  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const recognitionRef = useRef<any>(null);
  const voiceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 승인되고 마이크가 켜져 있으면 STT 시작, 취소/종료/뮤트되면 STT 중지
  useEffect(() => {
    if (myRequest?.status === 'approved' && !isMuted) {
      startSTT();
    } else {
      stopSTT();
      // 뮤트 시 텍스트를 초기화하지는 않음 (나중에 이어서 말할 수 있도록)
      // 하지만 done 상태가 되면 초기화됨 (아래 else logic)
      if (myRequest?.status !== 'approved') {
        setTranscript('');
        setInterimText('');
      }
    }
    return () => stopSTT();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRequest?.status, isMuted]);

  const startSTT = () => {
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    const browserLang =
      typeof navigator !== "undefined" && navigator.language
        ? navigator.language
        : "ko-KR";
    recognition.lang = browserLang;

    recognition.onresult = (e: any) => {
      // 음성 활동 감지
      setIsVoiceActive(true);
      onVoiceActivity?.(true);
      if (voiceTimeoutRef.current) clearTimeout(voiceTimeoutRef.current);
      voiceTimeoutRef.current = setTimeout(() => {
        setIsVoiceActive(false);
        onVoiceActivity?.(false);
      }, 700);

      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      if (final) setTranscript((prev) => prev + final);
      setInterimText(interim);
    };

    recognition.onerror = (ev: { error?: string }) => {
      const code = ev?.error;
      if (code === "aborted" || code === "no-speech") return;
      console.warn("[STT]", code);
    };

    try {
      recognition.start();
    } catch (e) {
      console.warn("[STT] start failed", e);
    }
    recognitionRef.current = recognition;
  };

  const stopSTT = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setInterimText('');
    setIsVoiceActive(false);
    onVoiceActivity?.(false);
    if (voiceTimeoutRef.current) clearTimeout(voiceTimeoutRef.current);
  };

  const handleEndSpeech = () => {
    if (!myRequest) return;
    const finalText = (transcript + interimText).trim();
    stopSTT();
    onEndSpeech(myRequest.id, finalText);
    setTranscript('');
  };

  // 승인됨 — 발언 중
  if (myRequest?.status === 'approved') {
    return (
      <div className="flex flex-col gap-3">
        {/* 실시간 STT 미리보기 (대시보드는 밝은 배경 — 줌 패널 밖에 렌더됨) */}
        <div className="min-h-[60px] max-h-[100px] overflow-y-auto rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="mb-1 flex items-center gap-1.5">
            <Mic
              size={12}
              className={`transition-all duration-300 ${
                isVoiceActive ? 'scale-125 text-green-600' : 'text-slate-300'
              } ${isVoiceActive ? 'animate-pulse' : ''}`}
            />
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
              {isVoiceActive ? 'Speaking...' : 'Listening...'}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-slate-800">
            {transcript}
            <span className="font-medium italic text-slate-400">{interimText}</span>
            {!transcript && !interimText && (
              <span className="italic text-slate-400">Waiting for voice...</span>
            )}
          </p>
        </div>

        <Button
          onClick={handleEndSpeech}
          className="w-full justify-center gap-3 bg-red-500 hover:bg-red-600 py-8 text-xl font-black shadow-xl uppercase tracking-[0.15em] active:scale-95 transition-transform rounded-2xl"
        >
          <Square size={20} className="fill-white" />
          End Speech
        </Button>
      </div>
    );
  }

  // 대기 중 — 방장 승인 기다리는 중
  if (myRequest?.status === 'pending') {
    return (
      <Button
        disabled
        className="w-full justify-center gap-3 bg-amber-500/80 py-8 text-xl font-black shadow-xl uppercase tracking-[0.15em] rounded-2xl cursor-not-allowed"
      >
        <Clock size={20} className="animate-pulse" />
        Waiting for Approval...
      </Button>
    );
  }

  // 기본 상태
  return (
    <Button
      onClick={onRequest}
      className="w-full justify-center gap-3 bg-brand hover:bg-brand-hover py-8 text-xl font-black shadow-xl shadow-brand/20 uppercase tracking-[0.15em] active:scale-95 transition-transform rounded-2xl"
    >
      <Hand size={24} className="animate-bounce" />
      Request to Speak
    </Button>
  );
}
