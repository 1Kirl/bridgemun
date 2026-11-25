/**
 * 메인 "Upcoming Forums" 등에 노출할지 판단.
 * - 종료된 세션(status closed)
 * - 예정일(forum.date, YYYY-MM-DD)이 오늘(로컬) 이전
 * - 생성 시점 기준 세션 타이머(분)가 이미 경과
 */
export function isForumUpcomingOnLanding(
  forum: Record<string, unknown>,
  nowMs: number = Date.now(),
): boolean {
  if (forum.status === "closed") return false;

  const ymd = parseScheduleYmd(
    typeof forum.date === "string" ? forum.date : undefined,
  );
  if (ymd) {
    const today = localYmd(nowMs);
    if (ymd < today) return false;
  }

  const ca = forum.createdAt as { toDate?: () => Date } | undefined;
  const created = ca?.toDate?.();
  if (created instanceof Date && !Number.isNaN(created.getTime())) {
    const durationMin = parseInt(String(forum.time ?? "60"), 10);
    const safeMin =
      Number.isFinite(durationMin) && durationMin > 0 ? durationMin : 60;
    const endMs = created.getTime() + safeMin * 60 * 1000;
    if (nowMs > endMs) return false;
  }

  return true;
}

function parseScheduleYmd(dateStr: string | undefined): string | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const s = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function localYmd(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
