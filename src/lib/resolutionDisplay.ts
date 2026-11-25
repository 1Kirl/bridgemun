/**
 * 결의안 번호·표시용 문자열 (QA: 클라이언트 현재 연도가 아닌 포럼 일정 기준).
 */

export type ResolutionForumFields = {
  topic?: string;
  subtopic?: string;
  /** YYYY-MM-DD from forum creation flow */
  date?: string;
  createdAt?: { toDate?: () => Date } | null;
};

/** 예: Resolution A/2026/1: climate change */
export function getResolutionProtocolTitle(forum: ResolutionForumFields): string {
  const topic = forum.topic?.trim() || "Current Resolution";
  let year = new Date().getFullYear();
  if (forum.date && /^\d{4}-\d{2}-\d{2}$/.test(forum.date)) {
    year = parseInt(forum.date.slice(0, 4), 10);
    if (!Number.isFinite(year)) year = new Date().getFullYear();
  } else {
    const c = forum.createdAt?.toDate?.();
    if (c instanceof Date && !Number.isNaN(c.getTime())) {
      year = c.getFullYear();
    }
  }
  const shortTopic = `${topic.slice(0, 72)}${topic.length > 72 ? "…" : ""}`;
  return `Resolution A/${year}/1: ${shortTopic}`;
}

export function getDefaultResolutionBody(forum: ResolutionForumFields): string {
  const t = forum.topic?.trim() || "this agenda item";
  const st = forum.subtopic?.trim();
  const focus = st ? `, with particular attention to "${st}"` : "";
  return (
    `This draft resolution urges coordinated multilateral action on "${t}"${focus}. ` +
    `It calls for transparent national reporting, phased implementation, and support for developing delegations. ` +
    `Delegates are invited to cast a national position: Yes (for), No (against), or Abstain.`
  );
}
