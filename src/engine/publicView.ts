import type { Ballot, ForumEngineState, SeatId } from "@/engine/types";

/**
 * What every member may see. Differs from the private state only in that individual choices on
 * OPEN ballots are hidden (who has voted is visible; how is revealed at close). This keeps AI and
 * humans from simply following an emerging majority.
 */
export type PublicBallot = Omit<Ballot, "votes"> & { votes: Record<SeatId, string> | null; voted: SeatId[] };

export type PublicForumState = Omit<ForumEngineState, "ballots"> & { ballots: Record<string, PublicBallot> };

export function toPublicState(s: ForumEngineState): PublicForumState {
  const ballots: Record<string, PublicBallot> = {};
  for (const [id, b] of Object.entries(s.ballots)) {
    const closed = b.status === "closed" || b.status === "not_held";
    ballots[id] = { ...b, votes: closed ? { ...b.votes } : null, voted: Object.keys(b.votes) };
  }
  return { ...s, ballots };
}
