'use client';

import type { BoardPostSummary, SentimentSummary } from '@/lib/hansae/data';

interface Props {
  companyName: string;
  ticker: string;
  posts: BoardPostSummary[];
  summary: SentimentSummary;
}

function pct(n: number, total: number) {
  if (total === 0) return 0;
  return Math.round((n / total) * 100);
}

function labelColor(label: BoardPostSummary['label']): string {
  if (label === 'positive') return 'bg-red-500/15 text-red-500 border-red-500/30';
  if (label === 'negative') return 'bg-blue-500/15 text-blue-500 border-blue-500/30';
  return 'bg-muted text-muted-foreground border-border';
}

function labelText(label: BoardPostSummary['label']): string {
  if (label === 'positive') return '긍정';
  if (label === 'negative') return '부정';
  if (label === 'neutral') return '중립';
  return '분석중';
}

export default function HansaeBoardPanel({ companyName, ticker, posts, summary }: Props) {
  const posPct = pct(summary.positive, summary.total);
  const negPct = pct(summary.negative, summary.total);
  const neuPct = pct(summary.neutral, summary.total);

  return (
    <div className="h-full rounded-md border border-border bg-card p-4 flex flex-col min-h-0">
      <div className="flex items-baseline justify-between mb-3 shrink-0">
        <h2 className="text-lg font-semibold">개인투자자</h2>
        <a
          href={`https://finance.naver.com/item/board.naver?code=${ticker}`}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-muted-foreground hover:underline"
        >
          {companyName} 토론실 →
        </a>
      </div>

      {summary.total === 0 ? (
        <div className="text-sm text-muted-foreground mb-3">
          최근 7일 감성 분석 결과 없음 (수집 / 분석 cron이 한 번 이상 돌아야 함)
        </div>
      ) : (
        <div className="mb-3">
          <div className="flex h-3 w-full overflow-hidden rounded-full border border-border">
            <div className="bg-red-500" style={{ width: `${posPct}%` }} title={`긍정 ${posPct}%`} />
            <div className="bg-muted" style={{ width: `${neuPct}%` }} title={`중립 ${neuPct}%`} />
            <div
              className="bg-blue-500"
              style={{ width: `${negPct}%` }}
              title={`부정 ${negPct}%`}
            />
          </div>
          <div className="mt-1 flex justify-between text-sm text-muted-foreground">
            <span className="text-red-500">긍정 {posPct}%</span>
            <span>중립 {neuPct}%</span>
            <span className="text-blue-500">부정 {negPct}%</span>
            <span>· 총 {summary.total}건 (7일)</span>
          </div>
        </div>
      )}

      <ul className="space-y-2 flex-1 overflow-auto pr-1">
        {posts.length === 0 ? (
          <li className="text-sm text-muted-foreground">수집된 글이 없습니다.</li>
        ) : (
          posts.map((p) => (
            <li key={p.postId} className="text-sm border-b border-border/50 pb-2 last:border-b-0">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block px-1.5 py-0.5 rounded border text-[11px] ${labelColor(p.label)}`}
                >
                  {labelText(p.label)}
                </span>
                <a
                  href={`https://finance.naver.com/item/board_read.naver?code=${ticker}&nid=${p.postId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 hover:underline line-clamp-1"
                >
                  {p.title}
                </a>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {new Date(p.postedAt).toLocaleString('ko-KR', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              {p.reason ? (
                <div className="text-[11px] text-muted-foreground mt-0.5 pl-1">↳ {p.reason}</div>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
