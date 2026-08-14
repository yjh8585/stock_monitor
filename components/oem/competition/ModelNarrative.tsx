'use client';

/**
 * AI 서술 5종 + 출처.
 *
 * 자리와 노출 규칙(사용자 지시 2026-08-14): KPI 카드 바로 아래에 놓고 **종합 판단 근거만 펼쳐 둔다.**
 * 등급이 왜 그렇게 나왔는지는 차트를 보기 전에 알아야 하는 정보라 접어 두면 아무도 안 편다. 나머지
 * 서술(판매 추이·경쟁 현황·소비자 평가·전망)과 출처는 근거를 더 파려는 사람만 펼치게 접어 둔다.
 */
import type { CompetitionMarket, CompetitionOutlook } from '@/lib/oem-competition/types';

function Block({ title, body }: { title: string; body: string | null }) {
  if (!body) return null;
  return (
    <div>
      <div className="text-xs text-muted-foreground font-medium mb-0.5">{title}</div>
      <p className="text-sm leading-relaxed">{body}</p>
    </div>
  );
}

export default function ModelNarrative({
  outlook,
  market,
}: {
  outlook: CompetitionOutlook;
  /** 지금 보고 있는 시장 — 주면 그 시장 코멘트만 싣는다(탭마다 다른 시장 얘기가 섞이지 않게). */
  market?: CompetitionMarket;
}) {
  const comments = market
    ? outlook.markets.filter((m) => m.market === market.market && m.comment)
    : outlook.markets.filter((m) => m.comment);

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium text-muted-foreground">종합 판단 근거</span>
          <span className="text-xs text-muted-foreground">
            {outlook.label} · {outlook.noteDate}
          </span>
        </div>
        <p className="mt-0.5 text-sm leading-relaxed">{outlook.rationale}</p>
      </div>

      <details className="border-t border-border/50">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
          분석 서술 · 출처 {outlook.sources.length}건
        </summary>
        <div className="px-3 pb-3 space-y-3">
          <Block title="판매 추이" body={outlook.salesTrend} />
          <Block title="경쟁 현황" body={outlook.competitiveView} />
          <Block title="소비자 평가" body={outlook.consumerView} />
          <Block title="판매 전망" body={outlook.outlook} />

          {comments.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground font-medium mb-0.5">시장별 코멘트</div>
              <ul className="space-y-1">
                {comments.map((m) => (
                  <li key={m.market} className="text-sm leading-relaxed">
                    <span className="font-medium">{m.label}</span> · {m.comment}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {outlook.sources.length > 0 && (
            <div className="pt-2 border-t border-border/50">
              <div className="text-xs text-muted-foreground font-medium mb-1">
                출처 {outlook.sources.length}건
              </div>
              <ul className="space-y-1">
                {outlook.sources.map((s) => (
                  <li key={s.url} className="text-xs">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:underline"
                    >
                      [{s.date || '-'}] {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
