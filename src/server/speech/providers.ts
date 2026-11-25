import "server-only";

// ── Speech-to-text ──────────────────────────────────────────────

export type SttResult = { ok: true; text: string } | { ok: false; error: string };
export interface SttProvider {
  readonly name: string;
  transcribe(input: { audio: Uint8Array; mime: string; filename: string; prompt?: string }): Promise<SttResult>;
}

/** OpenAI file transcription (gpt-transcribe by default; model is configurable). */
export class OpenAIStt implements SttProvider {
  readonly name = "openai";
  constructor(
    private apiKey: string,
    private model = "gpt-transcribe",
    private fetchImpl: typeof fetch = fetch,
  ) {}
  async transcribe(input: { audio: Uint8Array; mime: string; filename: string; prompt?: string }): Promise<SttResult> {
    const form = new FormData();
    form.append("file", new Blob([input.audio as BlobPart], { type: input.mime }), input.filename);
    form.append("model", this.model);
    form.append("language", "en");
    if (input.prompt) form.append("prompt", input.prompt.slice(0, 800));
    try {
      const res = await this.fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
      const body = (await res.json().catch(() => ({}))) as { text?: string; error?: { code?: string } };
      if (!res.ok) return { ok: false, error: `openai_stt_http_${res.status}:${body.error?.code ?? ""}` };
      const text = (body.text ?? "").trim();
      return text ? { ok: true, text } : { ok: false, error: "empty_transcript" };
    } catch {
      return { ok: false, error: "openai_stt_network" };
    }
  }
}

export class MockStt implements SttProvider {
  readonly name = "mock";
  async transcribe(input: { audio: Uint8Array }): Promise<SttResult> {
    if (input.audio.byteLength < 200) return { ok: false, error: "audio_too_short" };
    return { ok: true, text: `[MOCK TRANSCRIPT — not OpenAI] ${Math.round(input.audio.byteLength / 1000)} kB of audio received.` };
  }
}

// ── Text-to-speech ──────────────────────────────────────────────

export type TtsResult = { ok: true; audio: Uint8Array; mime: string; durationMs: number } | { ok: false; error: string };
export interface TtsProvider {
  readonly name: string;
  synthesize(input: { text: string; voiceId: string; modelId: string }): Promise<TtsResult>;
}

/** ElevenLabs TTS, MP3 44.1 kHz / 128 kbps (constant bitrate → duration from size). */
export class ElevenLabsTts implements TtsProvider {
  readonly name = "elevenlabs";
  constructor(
    private apiKey: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}
  async synthesize(input: { text: string; voiceId: string; modelId: string }): Promise<TtsResult> {
    try {
      const res = await this.fetchImpl(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify({ text: input.text, model_id: input.modelId }),
        },
      );
      if (!res.ok) return { ok: false, error: `elevenlabs_http_${res.status}` };
      const audio = new Uint8Array(await res.arrayBuffer());
      if (audio.byteLength < 1000) return { ok: false, error: "elevenlabs_empty_audio" };
      return { ok: true, audio, mime: "audio/mpeg", durationMs: Math.round((audio.byteLength * 8) / 128) };
    } catch {
      return { ok: false, error: "elevenlabs_network" };
    }
  }
}

/** Mock TTS: real, playable silent WAV whose length matches ~150 words/min. Never mistaken for ElevenLabs. */
export class MockTts implements TtsProvider {
  readonly name = "mock";
  async synthesize(input: { text: string }): Promise<TtsResult> {
    const words = input.text.split(/\s+/).filter(Boolean).length;
    const durationMs = Math.max(1000, Math.round((words / 2.5) * 1000));
    return { ok: true, audio: silentWav(durationMs), mime: "audio/wav", durationMs };
  }
}

export function silentWav(durationMs: number, sampleRate = 8000): Uint8Array {
  const n = Math.round((durationMs / 1000) * sampleRate);
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + n, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  w(36, "data");
  v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128);
  return new Uint8Array(buf);
}
