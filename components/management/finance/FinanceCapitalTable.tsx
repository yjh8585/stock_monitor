'use client';

import { Fragment, useMemo } from 'react';
import { ChartSection } from '@/components/management/plan/_selectors';
import { buildCapitalTable, computeDelta } from '@/lib/finance/aggregate';
import type { CapitalRow, FinanceRow } from '@/lib/finance/types';
import { cn } from '@/lib/utils';

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
}

interface Props {
  rows: FinanceRow[];
}

/**
 * 2. 투하자본·자금조달 표 (전체·연결 고정).
 * - 모든 연속 구간 증감열(▲파랑 증가 / ▼빨강 감소 + 금액·%).
 * - 위계: 섹션 → 소계 → 상세 → 합계. 채무는 (차감).
 */
export default function FinanceCapitalTable({ rows }: Props) {
  const table = useMemo(() => buildCapitalTable(rows, '전체'), [rows]);

  if (table.periods.length === 0) {
    return (
      <ChartSection title="2. 투하자본·자금조달" unit="억원 · 전체/연결">
        <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
      </ChartSection>
    );
  }

  const { periods, rows: tableRows } = table;
  return (
    <ChartSection title="2. 투하자본·자금조달" unit="억원 · 전체/연결">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="px-2 py-2 text-left font-medium">구분</th>
              {periods.map((p, i) => (
                <Fragment key={p}>
                  {i > 0 ? <th className="px-2 py-2 text-right font-medium">증감</th> : null}
                  <th className="px-2 py-2 text-right font-semibold text-foreground">{p}</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((r) => (
              <TableRow key={r.key} row={r} periodCount={periods.length} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        순운전자본 = 채권 + 재고 − 채무 · CAPEX = 유형자산 + 무형자산 · 투하자본 = 순운전자본 +
        CAPEX · 자금조달 = 현금 + 증자 + 차입금
      </p>
    </ChartSection>
  );
}

function TableRow({ row, periodCount }: { row: CapitalRow; periodCount: number }) {
  const isSection = row.kind === 'section';
  const isTotal = row.kind === 'total';
  const rowCls = cn(
    'border-b border-border/60',
    isSection && 'bg-muted/50 font-semibold',
    isTotal && 'border-t-2 border-border bg-muted/30 font-bold',
    row.kind === 'subtotal' && 'font-semibold'
  );
  const labelPad = row.level === 2 ? 'pl-8' : row.level === 1 ? 'pl-5' : 'pl-2';
  const label = row.subtract ? `${row.label} (차감)` : row.label;

  return (
    <tr className={rowCls}>
      <td className={cn('py-1.5 pr-2 text-left whitespace-nowrap', labelPad)}>{label}</td>
      {Array.from({ length: periodCount }).map((_, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <DeltaCell prev={row.values[i - 1]} curr={row.values[i]} blank={isSection} />
          ) : null}
          <td className="px-2 py-1.5 text-right tabular-nums">
            {isSection ? '' : fmt(row.values[i])}
          </td>
        </Fragment>
      ))}
    </tr>
  );
}

function DeltaCell({
  prev,
  curr,
  blank,
}: {
  prev: number | null;
  curr: number | null;
  blank?: boolean;
}) {
  if (blank) return <td className="px-2 py-1.5" />;
  const { abs, pct } = computeDelta(prev, curr);
  if (abs === null) {
    return <td className="px-2 py-1.5 text-right text-muted-foreground">—</td>;
  }
  const flat = abs === 0;
  const up = abs > 0;
  const color = flat ? 'text-muted-foreground' : up ? 'text-blue-600' : 'text-red-600';
  const arrow = flat ? '' : up ? '▲' : '▼';
  return (
    <td className={cn('px-2 py-1.5 text-right tabular-nums whitespace-nowrap', color)}>
      <span>
        {arrow} {fmt(Math.abs(abs))}
      </span>
      {pct !== null && !flat ? (
        <span className="ml-1 text-xs opacity-80">
          ({up ? '+' : ''}
          {pct.toFixed(1)}%)
        </span>
      ) : null}
    </td>
  );
}
