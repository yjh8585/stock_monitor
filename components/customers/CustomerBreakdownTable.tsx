// 구성비·점유율 표 — 행 = 한국어 라벨 · 열 = 기간. 물량 절의 「회사 발표 분기」 표(CustomerVolumeCompare)와 같은 클래스.
import type { BreakdownTable } from '@/lib/customers/breakdown';
import { cn } from '@/lib/utils';
import HighlightRow from './HighlightRow';

export default function CustomerBreakdownTable({ table }: { table: BreakdownTable }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">
        {table.title} <span className="text-xs text-muted-foreground">단위 {table.unitLabel}</span>
      </p>
      <div className="overflow-x-auto">
        <table className="text-xs tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className="px-2 py-1 text-left font-normal">구분</th>
              {table.columns.map((c) => (
                <th key={c.period} className="px-2 py-1 text-right font-normal">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <HighlightRow key={r.label} label={r.label} className="border-t border-border">
                <td className="px-2 py-1 whitespace-nowrap">{r.label}</td>
                {r.values.map((v, i) => {
                  const c = table.columns[i];
                  const d = r.yoy[i];
                  // 호버 = 전년 동기 대비 차이(%p) — 비율끼리라 증감률이 아니라 차이로 보인다.
                  const hint =
                    d == null || c.prevLabel == null
                      ? undefined
                      : `${c.prevLabel} 대비 ${d > 0 ? '+' : ''}${d.toFixed(1)}%p`;
                  return (
                    <td
                      key={c.period}
                      title={hint}
                      className={cn(
                        'px-2 py-1 text-right whitespace-nowrap',
                        hint &&
                          'cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2'
                      )}
                    >
                      {v == null ? '—' : v.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}
                    </td>
                  );
                })}
              </HighlightRow>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
