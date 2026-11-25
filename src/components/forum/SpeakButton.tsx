'use client';

import { useEffect, useRef, useState } from 'react';
import { Volume2, Square } from 'lucide-react';

type Props = {
  text: string;
  /** 읽어줄 언어 (기본 en-US) */
  lang?: string;
  className?: string;
  /** 버튼 옆에 라벨 표시 여부 */
  label?: string;
};

/**
 * 브라우저 Web Speech API(SpeechSynthesis)로 텍스트를 음성으로 읽어준다. (QA2 #2)
 * 자동 재생이 아니라 사용자가 버튼을 눌러 수동으로 재생/정지한다. 백엔드·토큰 불필요.
 */
export function SpeakButton({ text, lang = 'en-US', className, label }: Props) {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const speakingRef = useRef(false);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  // Chrome은 ~15초 이상 발화 시 끊기는 버그가 있어 주기적으로 resume() 한다.
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    setSupported(true);

    const loadVoices = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    loadVoices();
    // 보이스 목록은 비동기로 늦게 채워질 수 있음
    window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', loadVoices);
    };
  }, []);

  const stopKeepAlive = () => {
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
  };

  const finish = () => {
    speakingRef.current = false;
    stopKeepAlive();
    setSpeaking(false);
  };

  // 언마운트 시, 이 버튼이 재생 중이었다면 정지 (다른 재생은 건드리지 않음)
  useEffect(() => {
    return () => {
      if (speakingRef.current) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // best-effort
        }
        stopKeepAlive();
      }
    };
  }, []);

  if (!supported) return null;

  const toggle = () => {
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      finish();
      return;
    }
    const clean = text.trim();
    if (!clean) return;

    synth.cancel(); // 큐에 남은 다른 발화 정리

    const u = new SpeechSynthesisUtterance(clean);
    u.lang = lang;
    // 요청 언어에 맞는 보이스를 명시적으로 선택 (없으면 브라우저 기본)
    const prefix = lang.slice(0, 2).toLowerCase();
    const voice =
      voicesRef.current.find((v) => v.lang?.toLowerCase() === lang.toLowerCase()) ||
      voicesRef.current.find((v) => v.lang?.toLowerCase().startsWith(prefix));
    if (voice) u.voice = voice;
    u.rate = 1;
    u.onend = finish;
    u.onerror = finish;

    speakingRef.current = true;
    setSpeaking(true);

    // 일부 브라우저는 직전 cancel 후 paused 상태로 남아 speak가 안 먹는 경우가 있음
    synth.resume();
    synth.speak(u);

    stopKeepAlive();
    keepAliveRef.current = setInterval(() => {
      if (!speakingRef.current) {
        stopKeepAlive();
        return;
      }
      // Chrome long-text 끊김 방지
      synth.pause();
      synth.resume();
    }, 10000);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={speaking ? 'Stop' : 'Read aloud (AI voice)'}
      aria-label={speaking ? 'Stop reading' : 'Read aloud'}
      className={
        className ??
        `inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider transition-colors ${
          speaking
            ? 'bg-purple-600 text-white'
            : 'bg-purple-100 text-purple-700 hover:bg-purple-600 hover:text-white'
        }`
      }
    >
      {speaking ? <Square size={10} /> : <Volume2 size={10} />}
      {label ? <span>{label}</span> : null}
    </button>
  );
}
