'use client';

/**
 * AI 서술 5종 + 출처. 옛 카드(CompetitionCards)에서 서술 부분만 남긴 것.
 *
 * 차트가 "무슨 일이 일어났는지"를 보이고 여기가 "왜 그런지"를 말한다. 기본은 접어 두어
 * 차트가 먼저 눈에 들어오게 하고, 근거를 확인하려는 사람만 펼치게 한다.
 */
import type { CompetitionOutlook } from '@/lib/oem-competition/types';

function Block({ title, body }: { title: string; body: string | null }) {
  if (!body) return null;
  return (
    <div>
      <div className="text-xs text-muted-foreground font-medium mb-0.5">{title}</div>
      <p className="text-sm leading-relaxed">{body}</p>
    </div>
  );
}

export default function ModelNarrative({ outlook }: { outlook: CompetitionOutlook }) {
  return (
    <details className="rounded-md border border-border bg-card">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
        분석 서술 · 근거 · 출처 {outlook.sources.length}건
      </summary>
      <div className="px-3 pb-3 space-y-3">
        <Block title="판매 추이" body={outlook.salesTrend} />
        <Block title="경쟁 현황" body={outlook.competitiveView} />
        <Block title="소비자 평가" body={outlook.consumerView} />
        <Block title="판매 전망" body={outlook.outlook} />

        {outlook.markets.some((m) => m.comment) && (
          <div>
            <div className="text-xs text-muted-foreground font-medium mb-0.5">시장별 코멘트</div>
            <ul className="space-y-1">
              {outlook.markets
                .filter((m) => m.comment)
                .map((m) => (
                  <li key={m.market} className="text-sm leading-relaxed">
                    <span className="font-medium">{m.label}</span> · {m.comment}
                  </li>
                ))}
            </ul>
          </div>
        )}

        <div className="pt-2 border-t border-border/50">
          <div className="text-xs text-muted-foreground font-medium mb-0.5">종합 판단 근거</div>
          <p className="text-sm leading-relaxed italic text-muted-foreground">
            {outlook.rationale}
          </p>
        </div>

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
  );
}
