'use client';

import type { CompetitionOutlook, MarketBreakdown } from '@/lib/oem-competition/types';

const LABEL_STYLES: Record<CompetitionOutlook['label'], { bg: string; dot: string; text: string }> =
  {
    GREEN: {
      bg: 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900',
      dot: 'bg-green-500',
      text: 'text-green-700 dark:text-green-300',
    },
    YELLOW: {
      bg: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900',
      dot: 'bg-amber-500',
      text: 'text-amber-700 dark:text-amber-300',
    },
    RED: {
      bg: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900',
      dot: 'bg-red-500',
      text: 'text-red-700 dark:text-red-300',
    },
  };

function fmtPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '-';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function MarketRow({ market }: { market: MarketBreakdown }) {
  return (
    <div className="border-t border-border/50 pt-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-sm">{market.label}</span>
        <span className="text-sm tabular-nums text-muted-foreground">
          {market.sales.toLocaleString()}대 · YoY {fmtPct(market.yoy_pct)}
          {market.share_pct !== null && (
            <>
              {' '}
              · 점유 {market.share_pct}%
              {market.prev_share_pct !== null && ` (전년 ${market.prev_share_pct}%)`}
            </>
          )}
        </span>
      </div>
      {market.comment && <p className="text-sm leading-relaxed mt-1">{market.comment}</p>}
    </div>
  );
}

export default function CompetitionCards({ outlooks }: { outlooks: CompetitionOutlook[] }) {
  if (outlooks.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        분석 데이터 없음. <code>scripts/collect_oem_model_outlook.py</code> 실행이 필요합니다.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {outlooks.map((o) => {
        const style = LABEL_STYLES[o.label] ?? LABEL_STYLES.YELLOW;
        return (
          <div key={o.modelKey} className={`rounded-md border p-4 ${style.bg}`}>
            <div className="flex items-center justify-between mb-1">
              <div className="font-semibold text-base">{o.modelName}</div>
              <div className="flex items-center gap-1.5">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${style.dot}`} />
                <span className={`text-sm font-medium ${style.text}`}>{o.label}</span>
              </div>
            </div>
            <div className="text-sm text-muted-foreground mb-3">
              {o.oemGroup} · {o.noteDate}
            </div>

            <div className="space-y-3 text-sm">
              {o.markets.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground font-medium">시장별 현황</div>
                  {o.markets.map((m) => (
                    <MarketRow key={m.market} market={m} />
                  ))}
                </div>
              )}

              {o.competitiveView && (
                <div>
                  <div className="text-sm text-muted-foreground font-medium mb-1">경쟁 현황</div>
                  <p className="leading-relaxed">{o.competitiveView}</p>
                </div>
              )}

              <div>
                <div className="text-sm text-muted-foreground font-medium mb-1">소비자 평가</div>
                <p className="leading-relaxed">{o.consumerView}</p>
              </div>

              <div>
                <div className="text-sm text-muted-foreground font-medium mb-1">판매 전망</div>
                <p className="leading-relaxed">{o.outlook}</p>
              </div>

              <div className="pt-2 border-t border-border/50">
                <p className="text-sm text-muted-foreground italic leading-relaxed">
                  {o.rationale}
                </p>
              </div>

              {o.sources.length > 0 && (
                <details className="pt-1">
                  <summary className="text-sm text-muted-foreground cursor-pointer">
                    출처 {o.sources.length}건
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {o.sources.slice(0, 8).map((s) => (
                      <li key={s.url} className="text-sm">
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
                </details>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
