import { authedFetch } from "@/lib/authedFetch";
import type { Command, Expectation } from "@/engine/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await authedFetch(path, { method: "POST", body: JSON.stringify(body ?? {}) });
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? "error", data.message ?? data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export type CreateForumBody = {
  title: string;
  agenda: string;
  committeeId: string;
  countries: Array<{ code: string; name: string }>;
  ownerCountry: string;
  durationMin: number;
  speakingTimeSec: number;
  timers?: Partial<{ motionWindowSec: number; readingSec: number; votingSec: number; humanPrepSec: number }>;
};

export type LobbyInfo = {
  forumId: string;
  title: string;
  agenda: string;
  committeeId: string;
  status: string;
  isMember: boolean;
  seats: Array<{ id: string; countryName: string; kind: "human" | "ai"; mine: boolean }>;
};

export const forumApi = {
  create: (b: CreateForumBody) => call<{ forumId: string; joinCode: string }>("/api/forums", b),
  lookup: (code: string) => call<LobbyInfo>("/api/forums/lookup", { code }),
  claimSeat: (forumId: string, code: string, seat: string) =>
    call<{ forumId: string; seat: string; reconnect: boolean }>(`/api/forums/${forumId}/seat`, { code, seat }),
  command: (forumId: string, command: Command, expect?: Expectation) =>
    call<{ ok: boolean; duplicate: boolean; phaseId: string }>(`/api/forums/${forumId}/command`, { command, expect }),
  nudge: (forumId: string) => call<{ advanced: boolean; reason: string }>(`/api/forums/${forumId}/nudge`),
  presence: (forumId: string, online: boolean) => call<{ ok: boolean }>(`/api/forums/${forumId}/presence`, { online }),
};

/** Human-readable text for common API error codes. */
export function explainError(e: unknown): string {
  if (e instanceof ApiError) {
    const map: Record<string, string> = {
      seat_taken: "Another delegate took this country a moment ago. Please choose another.",
      join_locked: "This forum has already started; new participants can no longer join.",
      forum_started: "This forum has already started; new participants can no longer join.",
      already_seated: "You already represent a country in this forum.",
      code_not_found: "No forum uses this code.",
      bad_code: "Please enter the 6-character code.",
      not_a_member: "You have not joined this forum.",
      owner_only: "Only the room owner can do this.",
      paused: "The app is paused by the room owner.",
      database_unavailable: "The server cannot save changes right now (database quota or outage). Please try again later.",
    };
    return map[e.code] ?? e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
