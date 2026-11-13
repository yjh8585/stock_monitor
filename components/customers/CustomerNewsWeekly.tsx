// 서버 컴포넌트 — 주간 요약 줄과 근거 링크뿐이라 클라이언트 코드가 필요 없다.
import type { NewsWeek } from '@/lib/customers/summaries';
import SummaryLine from './SummaryLine';

/** 「2026-11-02」 → 「11월 2일 주」(달력 날짜 문자열을 그대로 자른다 — 시간대 변환 없음). */
function weekLabel(weekStart: string): string {
  return `${Number(weekStart.slice(5, 7))}월 ${Number(weekStart.slice(8, 10))}일 주`;
}

/**
 * 「주간 뉴스 요약」 — 회사별 주 1개 3~5줄(기사 제목·발췌 기반 API 요약 · 검사 통과분만) + 근거 기사 2~3개.
 * 최근 4주. 0건이면 숨긴다. 바로 아래 PopupNewsSection(최신 뉴스 목록) 위에 둔다.
 */
export default function CustomerNewsWeekly({ weeks }: { weeks: NewsWeek[] }) {
  if (weeks.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">주간 뉴스 요약</h2>
      <ul className="divide-y divide-border rounded-md border border-border">
        {weeks.map((w) => (
          <li key={w.weekStart} className="space-y-1.5 px-3 py-2.5">
            <p className="text-xs font-medium text-muted-foreground">{weekLabel(w.weekStart)}</p>
            <ul className="list-disc space-y-0.5 pl-5 text-sm">
              {w.lines.map((line, i) => (
                <li key={i}>
                  <SummaryLine line={line} />
                </li>
              ))}
            </ul>
            {w.links.length > 0 && (
              <ul className="space-y-0.5 text-xs">
                {w.links.map((l) => (
                  <li key={l.url} className="truncate">
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline dark:text-blue-400"
                      title={l.title}
                    >
                      {l.title}
                    </a>
                    {l.source && <span className="text-muted-foreground"> · {l.source}</span>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
