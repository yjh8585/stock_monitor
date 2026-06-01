import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { UzbekistanModelYearTable as TableData } from '@/lib/oem-companies/uzbekistan/source';

interface Props {
  data: TableData;
  title?: string;
  footer?: React.ReactNode;
}

function fmt(n: number | null): string {
  return n == null ? '-' : n.toLocaleString('ko-KR');
}

/** 차종(모델)별 연도별 생산량 표 — 연도 컬럼 + 최신 YTD + YoY. */
export default function UzbekistanModelYearTable({
  data,
  title = '차종별 생산량 (연도별)',
  footer,
}: Props) {
  if (data.columns.length === 0 || data.rows.length === 0) return null;

  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm tabular-nums">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="px-2 py-2 text-left font-medium">차종</th>
                {data.columns.map((c) => (
                  <th key={c.year} className="px-2 py-2 text-right font-medium whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-medium whitespace-nowrap">YoY</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.model} className="border-b last:border-0">
                  <td className="px-2 py-1.5 text-left font-medium">{row.model}</td>
                  {data.columns.map((c) => (
                    <td key={c.year} className="px-2 py-1.5 text-right">
                      {fmt(row.cells[c.year])}
                    </td>
                  ))}
                  <td
                    className={`px-2 py-1.5 text-right ${
                      row.yoyPct == null
                        ? 'text-muted-foreground'
                        : row.yoyPct > 0
                          ? 'text-emerald-600'
                          : 'text-rose-600'
                    }`}
                  >
                    {row.yoyPct == null
                      ? '-'
                      : `${row.yoyPct > 0 ? '+' : ''}${row.yoyPct.toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {footer && <div className="mt-2 px-1 text-[11px] text-muted-foreground">{footer}</div>}
      </CardContent>
    </Card>
  );
}
