/**
 * Small REAL-API verification (paid calls). Uses the same provider classes, prompts and schemas as the app.
 *   node scripts/with-env.mjs .env.project.local -- tsx --conditions=react-server scripts/verify-real.ts <outDir>
 * Prints results and usage; never prints keys. Audio files are written to <outDir>.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { OpenAILlm } from "../src/server/ai/llm";
import { evidenceBlock, SPEECH_SCHEMA, SYSTEM_PROMPT, votesSchemaFor } from "../src/server/ai/prompts";
import { loadPositionSet, retrieve, type PositionSet } from "../src/server/positions/positions";
import { ElevenLabsTts, OpenAIStt } from "../src/server/speech/providers";
import { VOICE_POOL } from "../src/server/speech/voices";

const out = process.argv[2] ?? ".";
const env = process.env;
const decision = env.OPENAI_MODEL_DECISION ?? "gpt-6.1-terra";
const speechModel = env.OPENAI_MODEL_SPEECH ?? "gpt-6.2-sol";
const llm = new OpenAILlm(env.OPENAI_API_KEY!);
const usage = { llmCalls: 0, inTok: 0, outTok: 0, ttsChars: 0, sttCalls: 0 };

const RESOLUTION = `"Equitable Vaccine Access" (fixture test text)
  Recognizing the need for faster vaccine access in developing regions,
  1. Requires all Member States to impose compulsory licensing on pandemic vaccine patents within 12 months;
  2. Establishes a pooled procurement fund administered by WHO.`;

const VotesZ = z.object({ votes: z.array(z.object({ seat: z.string(), choice: z.enum(["yes", "no", "abstain"]), rationale: z.string(), evidenceIds: z.array(z.string()) })) });
const SpeechZ = z.object({ text: z.string(), rationale: z.string(), evidenceIds: z.array(z.string()) });

async function vote(set: PositionSet, label: string) {
  const ev = retrieve(set, "fr", "Pandemic vaccine sharing", RESOLUTION);
  const r = await llm.generate({
    model: decision,
    schemaName: "ballot_votes",
    schema: votesSchemaFor(["fr"]),
    maxOutputTokens: 600,
    validate: (x) => {
      const p = VotesZ.safeParse(x);
      return p.success ? p.data : null;
    },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `COMMITTEE: WHO_HMUN — AGENDA: Pandemic vaccine sharing\nSUBSTANTIVE VOTE on resolution:\n${RESOLUTION}\n\n--- seat "fr" = France; allowed: yes/no/abstain\n${evidenceBlock(ev)}` },
    ],
  });
  usage.llmCalls++;
  usage.inTok += r.usage?.input ?? 0;
  usage.outTok += r.usage?.output ?? 0;
  if (!r.ok) return console.log(`vote[${label}]: FAILED ${r.error}`), null;
  if (!r.data.votes.some((x) => x.seat === "fr")) console.log(`vote[${label}] raw seats: ${JSON.stringify(r.data.votes.map((x) => x.seat))}`);
  const v = r.data.votes.find((x) => x.seat === "fr");
  console.log(`vote[${label}] model=${r.model} match=${ev.matchLevel} → ${v?.choice} | cited ${v?.evidenceIds.join(",")} | ${v?.rationale.slice(0, 160)}`);
  return v?.choice ?? null;
}

(async () => {
  const base = loadPositionSet("fixture-v0", path.join(process.cwd(), "data/positions"))!;
  const flipped: PositionSet = {
    ...base,
    version: "fixture-flip",
    chunks: base.chunks.map((c) => (c.id === "fx-fr-vax-1" ? { ...c, text: "FIXTURE: France strongly supports compulsory licensing of pandemic vaccine patents and will vote YES on texts that impose it." } : c)),
  };
  const a = await vote(base, "fixture-v0 (France opposes compulsory licensing)");
  const b = await vote(flipped, "fixture-flip (France supports compulsory licensing)");
  console.log(`evidence sensitivity: ${a} → ${b} ${a && b && a !== b ? "(CHANGED as expected)" : "(did not change)"}`);
  if (env.VERIFY_VOTES_ONLY === "1") return console.log(`USAGE: ${JSON.stringify(usage)}`);

  const ev = retrieve(base, "fr", "Pandemic vaccine sharing", "technology transfer regional manufacturing");
  const s = await llm.generate({
    model: speechModel,
    schemaName: "delegate_speech",
    schema: SPEECH_SCHEMA,
    maxOutputTokens: 500,
    validate: (x) => {
      const p = SpeechZ.safeParse(x);
      return p.success ? p.data : null;
    },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `COMMITTEE: WHO_HMUN — AGENDA: Pandemic vaccine sharing\nYOU ARE: France (fr).\n${evidenceBlock(ev)}\nFormal debate. Deliver your statement now: at most 60 words.` },
    ],
  });
  usage.llmCalls++;
  usage.inTok += s.usage?.input ?? 0;
  usage.outTok += s.usage?.output ?? 0;
  if (!s.ok) return console.log(`speech: FAILED ${s.error}`);
  const text = s.data.text;
  console.log(`speech model=${s.model} (${text.split(/\s+/).length} words): ${text}`);

  const tts = new ElevenLabsTts(env.ELEVENLABS_API_KEY!);
  const voice = VOICE_POOL[0];
  let mp3: Uint8Array | null = null;
  for (const modelId of ["eleven_multilingual_v2", "eleven_v4"]) {
    const t0 = Date.now();
    const t = await tts.synthesize({ text, voiceId: voice.voiceId, modelId });
    usage.ttsChars += text.length;
    if (!t.ok) {
      console.log(`tts[${modelId}]: FAILED ${t.error}`);
      continue;
    }
    const f = path.join(out, `tts-${modelId}.mp3`);
    writeFileSync(f, t.audio);
    console.log(`tts[${modelId}] voice=${voice.label}: ${t.audio.byteLength} bytes, ~${(t.durationMs / 1000).toFixed(1)}s audio, latency ${Date.now() - t0}ms → ${f}`);
    mp3 ??= t.audio;
  }
  if (mp3) {
    const stt = new OpenAIStt(env.OPENAI_API_KEY!, env.OPENAI_MODEL_TRANSCRIBE ?? "gpt-transcribe");
    const t0 = Date.now();
    const r = await stt.transcribe({ audio: mp3, mime: "audio/mpeg", filename: "speech.mp3", prompt: "Model UN committee speech." });
    usage.sttCalls++;
    if (!r.ok) console.log(`stt: FAILED ${r.error}`);
    else {
      const norm = (x: string) => x.toLowerCase().match(/[a-z]+/g) ?? [];
      const A = norm(text);
      const B = new Set(norm(r.text));
      const overlap = A.filter((w) => B.has(w)).length / Math.max(1, A.length);
      console.log(`stt (${Date.now() - t0}ms): "${r.text}"\nword overlap with source: ${(overlap * 100).toFixed(0)}%`);
    }
  }
  console.log(`USAGE: ${JSON.stringify(usage)}`);
})();
