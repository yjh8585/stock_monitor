'use client';

import { METRIC_LABELS, METRIC_ORDER, METRICS_WITH_RATIO } from '@/lib/pnl/types';
import type { MetricKey } from '@/lib/pnl/types';

/** 표 한 행의 데이터 — 7개 지표 합계 + label용 셀들 */
export interface PnlTableRow {
  /** React key */
  key: string;
  /** 좌측 sticky 셀들의 값 (label) — 예: ['전사'], ['1실', '2023'], ['HKMC', '2024'] */
  labels: string[];
  /** 지표 값 합계 */
  revenue: number;
  material_cost: number;
  labor_cost: number;
  expense: number;
  sga: number;
  rnd: number;
  op_income: number;
}

interface PnlTableProps {
  /** 좌측 고정 헤더 (예: ['연도'] 또는 ['부문', '연도']) */
  leftHeaders: string[];
  rows: PnlTableRow[];
  /** 행 0개일 때 표시 */
  emptyText?: string;
}

/** 백만원 단위 천 단위 콤마. null/0/NaN은 '—' */
function fmtMillion(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  if (n === 0) return '0';
  return Math.round(n).toLocaleString('ko-KR');
}

/** % (소수 1자리). 매출이 0이면 '—' */
function fmtRatio(value: number, revenue: number): string {
  if (!revenue) return '—';
  const r = (value / revenue) * 100;
  return `${r.toFixed(1)}%`;
}

/**
 * 손익 표 공통 컴포넌트.
 *
 * - 좌측 N개 sticky 라벨 열 + 7개 지표 열
 * - 6개 지표(매출 제외)에는 매출 대비 % 함께 표시 (지표값 위, %는 작게 아래)
 * - 영업이익은 음수일 수 있어 색상 분기
 * - StickyTable과 달리 sticky/정렬 없음 — 정형 표 (월별 분석은 별개 차트로)
 */
export default function PnlTable({
  leftHeaders,
  rows,
  emptyText = '데이터가 없습니다.',
}: PnlTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {leftHeaders.map((h, i) => (
              <th
                key={`L-${i}`}
                className="sticky left-0 z-10 bg-muted/40 px-2 py-2 text-left font-medium text-muted-foreground whitespace-nowrap"
                style={{ left: `${i * 80}px` }}
              >
                {h}
              </th>
            ))}
            {METRIC_ORDER.map((m) => (
              <th
                key={m}
                className="px-2 py-2 text-right font-medium text-muted-foreground whitespace-nowrap"
                title={
                  METRICS_WITH_RATIO.has(m) ? `${METRIC_LABELS[m]} (매출 대비 %)` : METRIC_LABELS[m]
                }
              >
                {METRIC_LABELS[m]}
                {METRICS_WITH_RATIO.has(m) && (
                  <span className="text-[10px] text-muted-foreground/70"> (%)</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={leftHeaders.length + METRIC_ORDER.length}
                className="px-4 py-8 text-center text-muted-foreground"
              >
                {emptyText}
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <PnlRow key={row.key} row={row} leftCount={leftHeaders.length} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PnlRow({ row, leftCount }: { row: PnlTableRow; leftCount: number }) {
  return (
    <tr className="border-b border-border/50 hover:bg-muted/30">
      {row.labels.map((lbl, i) => (
        <td
          key={`l-${i}`}
          className="sticky left-0 z-[5] bg-background px-2 py-1.5 font-medium whitespace-nowrap"
          style={{ left: `${i * 80}px` }}
          title={lbl}
        >
          {lbl}
        </td>
      ))}
      {/* leftCount가 labels 개수와 같지 않을 경우 빈 칸 채움 (안전망) */}
      {Array.from({ length: Math.max(0, leftCount - row.labels.length) }).map((_, i) => (
        <td key={`pad-${i}`} className="px-2 py-1.5" />
      ))}
      {METRIC_ORDER.map((m) => (
        <MetricCell key={m} metric={m} value={row[m]} revenue={row.revenue} />
      ))}
    </tr>
  );
}

function MetricCell({
  metric,
  value,
  revenue,
}: {
  metric: MetricKey;
  value: number;
  revenue: number;
}) {
  const showRatio = METRICS_WITH_RATIO.has(metric);
  const isOpIncome = metric === 'op_income';
  const valueColor = isOpIncome && value < 0 ? 'text-red-500' : 'text-foreground';
  return (
    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
      <div className={valueColor}>{fmtMillion(value)}</div>
      {showRatio && (
        <div className="text-[10px] text-muted-foreground">{fmtRatio(value, revenue)}</div>
      )}
    </td>
  );
}
