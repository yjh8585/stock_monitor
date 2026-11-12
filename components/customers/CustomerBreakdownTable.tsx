// 구성비·점유율 표 — 행 = 한국어 라벨 · 열 = 기간. 물량 절의 「회사 발표 분기」 표(CustomerVolumeCompare)와 같은 클래스.
import type { BreakdownTable } from '@/lib/customers/breakdown';

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
              <tr key={r.label} className="border-t border-border">
                <td className="px-2 py-1 whitespace-nowrap">{r.label}</td>
                {r.values.map((v, i) => (
                  <td
                    key={table.columns[i].period}
                    className="px-2 py-1 text-right whitespace-nowrap"
                  >
                    {v == null ? '—' : v.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
