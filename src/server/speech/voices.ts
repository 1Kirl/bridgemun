import "server-only";
import voicesConfig from "../../../config/voices.json";
import { stableHash } from "@/engine/documents";

export type VoiceEntry = { voiceId: string; label: string; gender: string };
export const VOICE_POOL: VoiceEntry[] = voicesConfig.pool;

/**
 * Stable, collision-free voice per AI delegation within a forum (all voices are standard US English;
 * no country-specific accents). Same forum + same seat list → same mapping after any restart.
 * If a forum has more AI seats than the pool, voices are reused (documented limitation).
 */
export function assignVoices(forumId: string, aiSeatIds: string[], pool: VoiceEntry[] = VOICE_POOL): Record<string, VoiceEntry> {
  const out: Record<string, VoiceEntry> = {};
  const used = new Set<number>();
  for (const seat of [...aiSeatIds].sort()) {
    let i = parseInt(stableHash(`${forumId}:${seat}`).slice(0, 8), 16) % pool.length;
    if (used.size < pool.length) while (used.has(i)) i = (i + 1) % pool.length;
    used.add(i);
    out[seat] = pool[i];
  }
  return out;
}
