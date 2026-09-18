'use client';

import { useMemo, useState } from 'react';
import BasisToggle from './BasisToggle';
import { ROW_HIGHLIGHT_CLASS, useRowHighlight } from '@/lib/useRowHighlight';
import { aggregateBy, entriesForYear, getDisplayYearLabels } from '@/lib/pnl/aggregate';
import type { Basis } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';

interface Props {
  annualByBasis: EntriesByBasis;
}

/** 부문 값이 빈 행의 라벨 — 합계와 각 행의 합이 어긋나지 않도록 버리지 않고 모은다. */
const UNCLASSIFIED = '(미분류)';

function fmtMillion(v: number | null): string {
  if (v === null || Number.isNaN(v)) return '—';
  return Math.round(v).toLocaleString('ko-KR');
}

/** 전사 매출 대비 비중 % (소수 1자리). 분모가 0이면 '—' */
function fmtShare(part: number, total: number): string {
  if (!total || !Number.isFinite(total)) return '—';
  return `${((part / total) * 100).toFixed(1)}%`;
}

/**
 * 6. 부문별 매출 비중 — 1번 「전사 비용구조」와 같은 표 양식.
 *
 * - 행: 부문(구동·제동·조향·전장·기타) — 최근 연도 매출 desc 순 · 맨 아래 합계
 * - 열: 연도 (연결은 DB 연간 행 라벨 그대로, 별도는 월별에서 derive된 4자리)
 * - 각 셀: 매출액 백만원 (위) + **전사 매출 대비 비중 %** (아래)
 *
 * 🔴 비중의 분모는 **그 해 전사 매출**(모든 부문 합)이다. 표에 보이는 부문만 더해
 *    분모로 쓰면 값이 부풀려지므로, 부문이 빈 행도 `(미분류)`로 남겨 합계를 맞춘다.
 */
export default function DivisionRevenueShare({ annualByBasis }: Props) {
  const [basis, setBasis] = useState<Basis>('consolidated');
  const { highlighted, rowToggleProps } = useRowHighlight();

  const basisEntries = annualByBasis[basis];

  const { yearColumns, divisions } = useMemo(() => {
    const labels = getDisplayYearLabels(basisEntries, basis);

    const columns = labels.map((label) => {
      const agg = aggregateBy(entriesForYear(basisEntries, basis, label), ['division']);
      const revenueByDivision = new Map<string, number>();
      let total = 0;
      for (const row of agg) {
        const key = row.dims.division || UNCLASSIFIED;
        revenueByDivision.set(key, (revenueByDivision.get(key) ?? 0) + row.revenue);
        total += row.revenue;
      }
      return { label, revenueByDivision, total };
    });

    // 행 순서 — 최근 연도 매출 desc. 최근 연도에 없는 부문은 뒤로(가나다 순).
    const latest = columns[columns.length - 1];
    const names = new Set<string>();
    for (const c of columns) for (const name of c.revenueByDivision.keys()) names.add(name);
    const ordered = Array.from(names).sort((a, b) => {
      const ra = latest?.revenueByDivision.get(a) ?? 0;
      const rb = latest?.revenueByDivision.get(b) ?? 0;
      if (rb !== ra) return rb - ra;
      return a.localeCompare(b, 'ko');
    });

    return { yearColumns: columns, divisions: ordered };
  }, [basisEntries, basis]);

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">
            6. 부문별 매출 비중{' '}
            <span className="text-sm font-normal text-muted-foreground">· 단위 백만원</span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            각 칸의 아래 값은 그해 전사 매출에서 그 부문이 차지하는 비중입니다.
          </p>
        </div>
        <BasisToggle value={basis} onChange={setBasis} />
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-base table-fixed">
          <colgroup>
            <col style={{ width: '20%' }} />
            {yearColumns.map((c) => (
              <col key={c.label} style={{ width: `${80 / Math.max(1, yearColumns.length)}%` }} />
            ))}
          </colgroup>
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 bg-muted border-r border-border px-3 py-2 text-left font-medium">
                부문
              </th>
              {yearColumns.map((c) => (
                <th key={c.label} className="px-3 py-2 text-right font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {divisions.length === 0 && (
              <tr>
                <td
                  colSpan={yearColumns.length + 1}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  데이터가 없습니다.
                </td>
              </tr>
            )}
            {divisions.map((name) => {
              const isHl = highlighted.has(name);
              const labelBg = isHl ? ROW_HIGHLIGHT_CLASS : 'bg-card';
              return (
                <tr
                  key={name}
                  className={`cursor-pointer ${isHl ? ROW_HIGHLIGHT_CLASS : 'hover:bg-muted/30'}`}
                  {...rowToggleProps(name, name)}
                >
                  <td
                    className={`sticky left-0 z-10 ${labelBg} border-r border-border px-3 py-2 align-middle`}
                  >
                    {name}
                  </td>
                  {yearColumns.map((c) => {
                    const revenue = c.revenueByDivision.get(name);
                    return (
                      <td key={c.label} className="px-3 py-2 text-right align-middle tabular-nums">
                        <div>{fmtMillion(revenue ?? null)}</div>
                        <div className="text-sm text-muted-foreground">
                          {revenue === undefined ? '—' : fmtShare(revenue, c.total)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {divisions.length > 0 && (
              <tr
                className={`cursor-pointer border-t-2 border-border font-semibold ${
                  highlighted.has('합계') ? ROW_HIGHLIGHT_CLASS : 'bg-blue-100 dark:bg-blue-900/40'
                }`}
                {...rowToggleProps('합계', '합계')}
              >
                <td
                  className={`sticky left-0 z-10 ${
                    highlighted.has('합계')
                      ? ROW_HIGHLIGHT_CLASS
                      : 'bg-blue-100 dark:bg-blue-900/40'
                  } border-r border-border px-3 py-2 align-middle`}
                >
                  합계
                </td>
                {yearColumns.map((c) => (
                  <td key={c.label} className="px-3 py-2 text-right align-middle tabular-nums">
                    <div>{fmtMillion(c.total)}</div>
                    <div className="text-sm text-muted-foreground">{c.total ? '100.0%' : '—'}</div>
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
