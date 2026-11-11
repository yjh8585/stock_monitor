/**
 * 고객사 공식 문서 요약(customer_doc_summaries)·주간 뉴스 요약(customer_news_weekly)의 순수 접기 함수 —
 * source.ts 가 사외비 표(confidentialDb)에서 읽은 행을 화면 형으로 바꾼다.
 * JSONB 칸은 형태가 어긋날 수 있어 배열 아니면 버린다. 쪽 캡처의 Storage 키(pages[].key)는 화면에 넘기지 않는다
 * (캡처는 인증 프록시 /api/customers/doc-page/<docId>/<page> 가 DB 에서 키를 다시 읽는다).
 */

export type Importance = 'high' | 'mid' | 'low';

export type DocSummary = {
  docId: number;
  docType: string;
  title: string;
  url: string;
  publishedAt: string; // YYYY-MM-DD
  importance: Importance;
  importanceReason: string | null;
  lines: string[];
  pages: { page: number; caption: string }[]; // key 는 화면에 안 넘긴다
};

export type NewsLink = { title: string; url: string; source: string | null };

export type NewsWeek = {
  weekStart: string; // 그 주 월요일 YYYY-MM-DD(KST)
  lines: string[];
  links: NewsLink[];
};

/** 요약 표 「최근 중요 문서」 칸 재료. */
export type RecentDoc = {
  docId: number;
  docType: string;
  title: string;
  publishedAt: string;
  reason: string | null;
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseLines(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => (typeof x === 'string' && x.trim() ? [x.trim()] : []));
}

export function parsePages(v: unknown): { page: number; caption: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .flatMap((x) =>
      isObj(x) &&
      Number.isInteger(x.page) &&
      (x.page as number) > 0 &&
      typeof x.caption === 'string'
        ? [{ page: x.page as number, caption: x.caption }]
        : []
    )
    .sort((a, b) => a.page - b.page);
}

export function parseLinks(v: unknown): NewsLink[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) =>
    isObj(x) &&
    typeof x.title === 'string' &&
    x.title.trim() &&
    typeof x.url === 'string' &&
    /^https?:\/\//.test(x.url)
      ? [{ title: x.title, url: x.url, source: typeof x.source === 'string' ? x.source : null }]
      : []
  );
}

function importanceOf(v: unknown): Importance {
  return v === 'high' || v === 'mid' ? v : 'low';
}

/** customer_doc_summaries 행(+ customer_documents 내장 조인 — doc_id 는 1:1 FK 라 객체로 온다). 문서 메타·줄이 없으면 null. */
export function toDocSummary(row: {
  doc_id: number;
  importance: string | null;
  importance_reason: string | null;
  lines: unknown;
  pages: unknown;
  customer_documents: {
    doc_type: string;
    title: string;
    url: string;
    published_at: string;
  } | null;
}): DocSummary | null {
  const meta = row.customer_documents;
  const lines = parseLines(row.lines);
  if (!meta || lines.length === 0) return null;
  return {
    docId: row.doc_id,
    docType: meta.doc_type,
    title: meta.title,
    url: meta.url,
    publishedAt: meta.published_at.slice(0, 10),
    importance: importanceOf(row.importance),
    importanceReason: row.importance_reason,
    lines,
    pages: parsePages(row.pages),
  };
}

export function toNewsWeek(row: {
  week_start: string;
  lines: unknown;
  links: unknown;
}): NewsWeek | null {
  const lines = parseLines(row.lines);
  if (lines.length === 0) return null;
  return { weekStart: row.week_start, lines, links: parseLinks(row.links) };
}

/** 최신순(게시일 내림차순 · 같은 날이면 docId 큰 것 먼저). */
export function byRecent(a: DocSummary, b: DocSummary): number {
  return b.publishedAt.localeCompare(a.publishedAt) || b.docId - a.docId;
}

/** YYYY-MM-DD 두 날짜 사이 일수(b − a) — 둘 다 달력 날짜라 UTC 로 만들어 UTC 로 뺀다. */
function daysBetween(a: string, b: string): number {
  const ms = (s: string) =>
    Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

/** 오늘 기준 days 일 안(오늘 포함 · 미래 제외)의 중요도 상 문서 중 가장 최근 하나. */
export function pickRecentImportant(
  docs: DocSummary[],
  today: string,
  days = 30
): DocSummary | null {
  const hit = docs.filter((d) => {
    if (d.importance !== 'high') return false;
    const age = daysBetween(d.publishedAt, today);
    return age >= 0 && age <= days;
  });
  return hit.sort(byRecent)[0] ?? null;
}
