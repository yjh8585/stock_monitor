'use client';

import { Fragment, useMemo } from 'react';
import { ChartSection } from '@/components/management/plan/_selectors';
import { buildCapitalTable, computeDelta } from '@/lib/finance/aggregate';
import type { CapitalRow, FinanceRow } from '@/lib/finance/types';
import { ROW_HIGHLIGHT_CLASS, useRowHighlight } from '@/lib/useRowHighlight';
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
 * - 연속 구간 증감열(▲파랑 증가 / ▼빨강 감소 + 금액·%). 흐름 항목(당기순이익·신규증자)은 증감 대신 당기 발생액(+) 표시.
 * - ③ 현금: 한 줄에 잔액(값 칸) + 기간 증감(증감 칸). 섹션 헤더(①②)보다 진한 음영.
 * - 위계: 섹션 → 소계 → 상세 → 합계. 채무는 (차감).
 */
export default function FinanceCapitalTable({ rows }: Props) {
  const table = useMemo(() => buildCapitalTable(rows, '전체'), [rows]);
  const { highlighted, rowToggleProps } = useRowHighlight();

  if (table.periods.length === 0) {
    return (
      <ChartSection title="2. 투하자본·자금조달" unit="억원 · 전체/연결">
        <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
      </ChartSection>
    );
  }

  const { periods, rows: tableRows } = table;
  return (
    <ChartSection
      title="2. 투하자본·자금조달"
      unit="억원 · 전체/연결"
      controls={<CapitalBridgeText />}
    >
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
              <TableRow
                key={r.key}
                row={r}
                periodCount={periods.length}
                isHl={highlighted.has(r.key)}
                toggleProps={rowToggleProps(r.key, r.label)}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        순운전자본 = 채권 + 재고 − 채무 · CAPEX = 유형자산 + 무형자산 · 투하자본 = 순운전자본 +
        CAPEX · 자금조달 = 당기순이익 + 신규증자 + 차입금 · 현금 증감 칸 = 잔액의 기간 변화
      </p>
    </ChartSection>
  );
}

/** 제목 옆 증감 브리지(개념식): 투자 ≈ 순이익 + 신규증자 + 차입증가 − 현금증가. */
function CapitalBridgeText() {
  return (
    <span className="text-sm font-normal text-muted-foreground">
      <span className="font-semibold text-foreground">증감 브리지</span>
      <span className="mx-1.5">·</span>
      투자 ≈ 순이익 + 신규증자 + 차입증가 − 현금증가
    </span>
  );
}

function TableRow({
  row,
  periodCount,
  isHl,
  toggleProps,
}: {
  row: CapitalRow;
  periodCount: number;
  isHl: boolean;
  toggleProps: ReturnType<ReturnType<typeof useRowHighlight>['rowToggleProps']>;
}) {
  const isSection = row.kind === 'section';
  const isTotal = row.kind === 'total';
  // 자금조달·현금 섹션 시작 → 윗 영역과 이중 테두리선으로 명확히 구분
  const isFinancingStart = row.key === 'financing';
  const isCash = row.key === 'cash'; // ③ 현금 — 섹션 헤더보다 진한 회색 음영
  // 강조 시 기존 섹션·합계 배경을 노란 음영으로 덮되, 글꼴·테두리는 유지.
  const rowCls = cn(
    'border-b border-border/60 cursor-pointer',
    isSection && 'font-semibold',
    isTotal && 'border-t-2 border-border font-bold',
    row.kind === 'subtotal' && 'font-semibold',
    (isFinancingStart || isCash) && 'border-t-4 border-double border-foreground/40',
    isHl
      ? ROW_HIGHLIGHT_CLASS
      : cn(isSection && 'bg-muted/50', isTotal && 'bg-muted/30', isCash && 'bg-muted/70')
  );
  const labelPad = row.level === 2 ? 'pl-8' : row.level === 1 ? 'pl-5' : 'pl-2';
  const label = row.subtract ? `${row.label} (차감)` : row.label;

  return (
    <tr className={rowCls} {...toggleProps}>
      <td className={cn('py-1.5 pr-2 text-left whitespace-nowrap', labelPad)}>{label}</td>
      {Array.from({ length: periodCount }).map((_, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <DeltaCell
              prev={row.values[i - 1]}
              curr={row.values[i]}
              blank={isSection}
              flow={row.flow}
              override={row.deltaValues ? row.deltaValues[i] : undefined}
            />
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
  flow,
  override,
}: {
  prev: number | null;
  curr: number | null;
  blank?: boolean;
  /** 흐름 항목(신규증자) — 증감 대신 당기 신규 발생액(+)을 표시 */
  flow?: boolean;
  /** 증감값 직접 지정 (자금조달 합계). undefined면 curr−prev 자동 계산, null이면 — 표시. */
  override?: number | null;
}) {
  if (blank) return <td className="px-2 py-1.5" />;
  if (flow) {
    // 신규증자: 기간 간 차이가 아니라 당기 신규 발생액 자체를 표시(증감 계산 안 함).
    if (curr === null) {
      return <td className="px-2 py-1.5 text-right text-muted-foreground">—</td>;
    }
    if (curr === 0) {
      return <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">0</td>;
    }
    const up = curr > 0;
    return (
      <td
        className={cn(
          'px-2 py-1.5 text-right tabular-nums whitespace-nowrap',
          up ? 'text-blue-600' : 'text-red-600'
        )}
      >
        {up ? '▲' : '▼'} {fmt(Math.abs(curr))}
      </td>
    );
  }
  // override(자금조달 합계): 지정된 증감값 사용 + %는 직전 기간값 대비. 미지정 시 일반 curr−prev.
  const { abs, pct } =
    override !== undefined
      ? {
          abs: override,
          pct:
            override !== null && prev !== null && prev !== 0
              ? (override / Math.abs(prev)) * 100
              : null,
        }
      : computeDelta(prev, curr);
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
