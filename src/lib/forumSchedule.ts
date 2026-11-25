/**
 * 포럼 예약 종료 시각·투표 가능 여부 (QA: 타이머 경과 전에는 투표 불가).
 */

export type ForumScheduleInput = {
  status?: string;
  createdAt?: { toDate?: () => Date } | null;
  time?: string | number;
};

export function getForumDurationSeconds(forum: Pick<ForumScheduleInput, "time">): number {
  const durationMin = parseInt(String(forum.time ?? "60"), 10);
  return Number.isFinite(durationMin) && durationMin > 0 ? durationMin * 60 : 3600;
}

/** 예정 종료 시각(ms). createdAt 없으면 null. */
export function getForumScheduledEndMs(forum: ForumScheduleInput): number | null {
  const created = forum.createdAt?.toDate?.();
  if (!(created instanceof Date) || Number.isNaN(created.getTime())) return null;
  const sec = getForumDurationSeconds(forum);
  return created.getTime() + sec * 1000;
}

/** 예정 종료 시각이 지났는지 (상태 무관). createdAt 없으면 true(레거시). */
export function isScheduledEndReached(forum: ForumScheduleInput): boolean {
  const end = getForumScheduledEndMs(forum);
  if (end == null) return true;
  return Date.now() >= end;
}

/**
 * 투표·결과 집계를 허용할지: 세션이 닫혔고, 예정 종료 시각이 지났을 때.
 */
export function isForumVotingUnlocked(forum: ForumScheduleInput): boolean {
  if (forum.status !== "closed") return false;
  return isScheduledEndReached(forum);
}

export function formatScheduledEndLocal(forum: ForumScheduleInput): string | null {
  const end = getForumScheduledEndMs(forum);
  if (end == null) return null;
  try {
    return new Date(end).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return null;
  }
}
