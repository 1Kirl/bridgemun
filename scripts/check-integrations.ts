/**
 * Read-only connectivity check for the services configured in the CURRENT environment.
 * Never prints secret values — only whether they are set and what the provider returned.
 *
 *   npm run check:integrations                # uses process env (+ .env.local if present)
 *
 * Checks:
 *  - Firebase public/server config consistency (same guards the app uses)
 *  - OpenAI: lists models visible to the key, reports which candidate models are available
 *  - ElevenLabs: lists models and voices with an American accent label
 *  - Zoom: only checks that server variables are present (no API call is possible without a client)
 */
import { existsSync, readFileSync } from "node:fs";
import { parseFirebasePublicConfig, readRawPublicEnv } from "../src/lib/env/firebasePublicConfig";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env.development");

const OPENAI_CANDIDATES = (process.env.OPENAI_CANDIDATE_MODELS ??
  "gpt-6.2-sol,gpt-6.2-astra,gpt-6.1-terra,gpt-6-luna,gpt-transcribe,gpt-live-transcribe,text-embedding-3-small")
  .split(",")
  .map((s) => s.trim());

const set = (k: string) => (process.env[k]?.trim() ? "set" : "NOT SET");

async function checkFirebase() {
  try {
    const pub = parseFirebasePublicConfig(readRawPublicEnv());
    const server = process.env.FIREBASE_PROJECT_ID?.trim();
    console.log(`Firebase: mode=${pub.mode} project=${pub.projectId} serverProject=${server ?? "NOT SET"} ` +
      `match=${server === pub.projectId} serviceAccount=${set("FIREBASE_SERVICE_ACCOUNT_BASE64")}`);
  } catch (e) {
    console.log(`Firebase: CONFIG ERROR — ${(e as Error).message}`);
  }
}

async function checkOpenAI() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return console.log("OpenAI: OPENAI_API_KEY NOT SET (no call made)");
  const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return console.log(`OpenAI: models list failed HTTP ${res.status}`);
  const ids = new Set(((await res.json()) as { data: Array<{ id: string }> }).data.map((m) => m.id));
  console.log(`OpenAI: key OK, ${ids.size} models visible`);
  for (const c of OPENAI_CANDIDATES) console.log(`  ${ids.has(c) ? "available  " : "unavailable"} ${c}`);
}

async function checkElevenLabs() {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) return console.log("ElevenLabs: ELEVENLABS_API_KEY NOT SET (no call made)");
  const h = { "xi-api-key": key };
  const models = await fetch("https://api.elevenlabs.io/v1/models", { headers: h });
  if (!models.ok) return console.log(`ElevenLabs: models list failed HTTP ${models.status}`);
  const ml = (await models.json()) as Array<{ model_id: string; can_do_text_to_speech?: boolean }>;
  console.log(`ElevenLabs: key OK. TTS models: ${ml.filter((m) => m.can_do_text_to_speech).map((m) => m.model_id).join(", ")}`);
  const voices = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100", { headers: h });
  if (!voices.ok) return console.log(`ElevenLabs: voices list failed HTTP ${voices.status}`);
  const vl = ((await voices.json()) as { voices: Array<{ voice_id: string; name: string; labels?: Record<string, string> }> }).voices;
  const american = vl.filter((v) => (v.labels?.accent ?? "").toLowerCase().includes("american"));
  console.log(`ElevenLabs: ${vl.length} voices in account, ${american.length} labelled American accent`);
  for (const v of american.slice(0, 30)) {
    console.log(`  ${v.voice_id}  ${v.name}  ${v.labels?.gender ?? "?"}/${v.labels?.age ?? "?"}`);
  }
}

function checkZoom() {
  console.log(`Zoom: ZOOM_VIDEO_SDK_KEY=${set("ZOOM_VIDEO_SDK_KEY")} ZOOM_VIDEO_SDK_SECRET=${set("ZOOM_VIDEO_SDK_SECRET")} ` +
    `ZOOM_SESSION_SECRET=${set("ZOOM_SESSION_SECRET")}`);
}

function checkScheduler() {
  const d = process.env.SCHEDULER_DRIVER ?? "NOT SET";
  console.log(`Scheduler: driver=${d}` + (d === "qstash"
    ? ` QSTASH_TOKEN=${set("QSTASH_TOKEN")} signing=${set("QSTASH_CURRENT_SIGNING_KEY")}/${set("QSTASH_NEXT_SIGNING_KEY")} APP_BASE_URL=${set("APP_BASE_URL")}`
    : ""));
}

(async () => {
  await checkFirebase();
  checkZoom();
  checkScheduler();
  await checkOpenAI().catch((e) => console.log(`OpenAI: error ${(e as Error).message}`));
  await checkElevenLabs().catch((e) => console.log(`ElevenLabs: error ${(e as Error).message}`));
})();
