'use client';

import type { TableData } from '@/lib/personnel/types';

/** 숫자 포맷 — null이면 em-dash. */
function fmt(n: number | null): string {
  return n === null ? '—' : n.toLocaleString('ko-KR');
}

interface Props {
  data: TableData;
}

/**
 * 차트 5 — 인원 수 표.
 * - 시점별 컬럼(임원/사무/생산/소계) 4개씩.
 * - 행 type별 강조: detail / subtotal(소계 굵게+배경) / total(전체 합계 강조 배경).
 */
export default function PersonnelTable({ data }: Props) {
  const cellClass = (type: 'detail' | 'subtotal' | 'total') =>
    type === 'total'
      ? 'bg-blue-50 dark:bg-blue-950/40 font-bold'
      : type === 'subtotal'
        ? 'bg-muted/60 font-semibold'
        : '';

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-base">
        <thead className="bg-muted/40">
          <tr>
            <th
              rowSpan={2}
              className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left border-r border-border"
            >
              구분
            </th>
            <th
              rowSpan={2}
              className="sticky left-[80px] z-10 bg-muted/40 px-3 py-2 text-left border-r border-border min-w-[140px]"
            >
              상세
            </th>
            {data.periods.map((p) => (
              <th
                key={p.date}
                colSpan={4}
                className="px-2 py-1.5 text-center border-l border-border font-semibold"
              >
                {p.label}
              </th>
            ))}
          </tr>
          <tr>
            {data.periods.flatMap((p) => [
              <th
                key={`${p.date}-임원`}
                className="px-2 py-1 text-right text-sm font-medium text-muted-foreground border-l border-border"
              >
                임원
              </th>,
              <th
                key={`${p.date}-사무`}
                className="px-2 py-1 text-right text-sm font-medium text-muted-foreground"
              >
                사무
              </th>,
              <th
                key={`${p.date}-생산`}
                className="px-2 py-1 text-right text-sm font-medium text-muted-foreground"
              >
                생산
              </th>,
              <th
                key={`${p.date}-소계`}
                className="px-2 py-1 text-right text-sm font-semibold border-r border-border"
              >
                소계
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, idx) => (
            <tr key={idx} className={cellClass(r.type)}>
              <td
                className="sticky left-0 z-10 px-3 py-1.5 border-r border-t border-border text-sm whitespace-nowrap"
                style={{ background: 'inherit' }}
              >
                {r.group}
              </td>
              <td
                className="sticky left-[80px] z-10 px-3 py-1.5 border-r border-t border-border text-sm whitespace-nowrap"
                style={{ background: 'inherit' }}
              >
                {r.label}
              </td>
              {data.periods.flatMap((p) => {
                const c = r.values[p.date] ?? { 임원: null, 사무: null, 생산: null, total: null };
                return [
                  <td
                    key={`${p.date}-임원`}
                    className="px-2 py-1.5 text-right border-l border-t border-border tabular-nums"
                  >
                    {fmt(c.임원)}
                  </td>,
                  <td
                    key={`${p.date}-사무`}
                    className="px-2 py-1.5 text-right border-t border-border tabular-nums"
                  >
                    {fmt(c.사무)}
                  </td>,
                  <td
                    key={`${p.date}-생산`}
                    className="px-2 py-1.5 text-right border-t border-border tabular-nums"
                  >
                    {fmt(c.생산)}
                  </td>,
                  <td
                    key={`${p.date}-소계`}
                    className="px-2 py-1.5 text-right border-t border-r border-border font-medium tabular-nums"
                  >
                    {fmt(c.total)}
                  </td>,
                ];
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
