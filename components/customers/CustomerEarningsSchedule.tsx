// 서버 컴포넌트 — 작은 상자 하나.
import type { NextEarnings } from '@/lib/customers/ir';
import { periodText } from '@/lib/customers/format';

const SOURCE: Record<string, string> = { dart: 'DART', edgar: 'SEC EDGAR', ir: '회사 IR' };

/** 다음 실적 일정 — 확정이면 출처 링크 · 추정이면 「작년 같은 분기 발표일 + 1년」 표시. */
export default function CustomerEarningsSchedule({ next }: { next: NextEarnings | null }) {
  return (
    <div className="inline-block rounded-md border border-border px-3 py-2 text-sm">
      <span className="text-muted-foreground">다음 실적 · </span>
      {next == null ? (
        <span className="text-muted-foreground">일정 자료 없음</span>
      ) : (
        <>
          <span className={next.estimated ? 'text-muted-foreground' : 'font-medium'}>
            {next.date}
          </span>{' '}
          ({periodText(next.period)})
          {next.estimated ? (
            <span className="ml-2 rounded border border-border px-1.5 text-[11px] text-muted-foreground">
              추정 — 작년 같은 분기 발표일 + 1년
            </span>
          ) : (
            <span className="ml-2 text-xs text-muted-foreground">
              출처{' '}
              {next.url ? (
                <a
                  href={next.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {SOURCE[next.source ?? ''] ?? next.source ?? '원문'}
                </a>
              ) : (
                (SOURCE[next.source ?? ''] ?? next.source ?? '미기록')
              )}
            </span>
          )}
        </>
      )}
    </div>
  );
}
