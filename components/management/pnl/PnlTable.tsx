'use client';

import { useMemo, useState } from 'react';
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
  /** 합계 행 등 강조 표시 */
  isSummary?: boolean;
}

interface PnlTableProps {
  /** 좌측 고정 헤더 (예: ['연도'] 또는 ['부문', '연도']) */
  leftHeaders: string[];
  rows: PnlTableRow[];
  /**
   * 좌측 N개 라벨 중 앞쪽 dimCount개가 "차원"으로 간주된다.
   * - 차원 컬럼: 연속 동일값 rowspan 병합 대상
   * - 1차 차원(label[0])이 바뀌는 경계 행에 굵은 위쪽 테두리
   * - 차원 외 라벨(예: 연도)은 항상 단일 셀
   */
  dimCount?: number;
  /** 행 0개일 때 표시 */
  emptyText?: string;
}

const STICKY_LEFT_PX = 140;

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

interface RowMeta {
  /** dimCount 길이. 각 dim 컬럼의 rowspan(>0=렌더, 0=상위 셀에 흡수되어 렌더 생략) */
  spans: number[];
  /** 1차 dim이 직전 행과 달라 그룹 경계인 행에 true */
  isGroupBoundary: boolean;
}

/** rowspan + 그룹 경계 계산 (단일 패스) */
function computeRowMetas(rows: PnlTableRow[], dimCount: number): RowMeta[] {
  const metas: RowMeta[] = rows.map(() => ({ spans: [], isGroupBoundary: false }));
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const meta = metas[i];
    for (let d = 0; d < dimCount; d += 1) {
      let isContinuation = false;
      if (i > 0) {
        const prev = rows[i - 1];
        let parentMatch = true;
        for (let p = 0; p < d; p += 1) {
          if (prev.labels[p] !== row.labels[p]) {
            parentMatch = false;
            break;
          }
        }
        if (parentMatch && prev.labels[d] === row.labels[d]) {
          isContinuation = true;
        }
      }
      if (isContinuation) {
        meta.spans.push(0);
      } else {
        let span = 1;
        for (let k = i + 1; k < rows.length; k += 1) {
          let match = true;
          for (let p = 0; p <= d; p += 1) {
            if (rows[k].labels[p] !== row.labels[p]) {
              match = false;
              break;
            }
          }
          if (match) span += 1;
          else break;
        }
        meta.spans.push(span);
      }
    }
    meta.isGroupBoundary = dimCount > 0 && i > 0 && rows[i - 1].labels[0] !== row.labels[0];
  }
  return metas;
}

/**
 * 손익 표 공통 컴포넌트.
 *
 * - 좌측 N개 라벨 (앞 dimCount개는 "차원" — rowspan 병합 + 그룹 경계 굵은 테두리) + 7개 지표 열
 * - 6개 지표(매출 제외)에는 매출 대비 % 함께 표시 (지표값 위, %는 작게 아래)
 * - 매출/영업이익 컬럼은 헤더·값 모두 볼드 강조
 * - 영업이익 음수는 빨강
 * - 행 클릭 → 노란색 음영 토글 (관련주식 표 패턴 — aria-pressed/Enter·Space 키보드 지원)
 */
export default function PnlTable({
  leftHeaders,
  rows,
  dimCount = 0,
  emptyText = '데이터가 없습니다.',
}: PnlTableProps) {
  const [highlighted, setHighlighted] = useState<Set<string>>(() => new Set());

  const toggleHighlight = (key: string) => {
    setHighlighted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const rowMetas = useMemo(() => computeRowMetas(rows, dimCount), [rows, dimCount]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {leftHeaders.map((h, i) => (
              <th
                key={`L-${i}`}
                scope="col"
                className="sticky left-0 z-10 bg-muted/40 px-2 py-2 text-left font-medium text-muted-foreground whitespace-nowrap"
                style={{
                  left: `${i * STICKY_LEFT_PX}px`,
                  minWidth: STICKY_LEFT_PX,
                  maxWidth: STICKY_LEFT_PX,
                }}
              >
                {h}
              </th>
            ))}
            {METRIC_ORDER.map((m) => {
              const emphasized = m === 'revenue' || m === 'op_income';
              return (
                <th
                  key={m}
                  scope="col"
                  className={`px-2 py-2 text-right whitespace-nowrap ${
                    emphasized ? 'font-bold text-foreground' : 'font-medium text-muted-foreground'
                  }`}
                  title={
                    METRICS_WITH_RATIO.has(m)
                      ? `${METRIC_LABELS[m]} (매출 대비 %)`
                      : METRIC_LABELS[m]
                  }
                >
                  {METRIC_LABELS[m]}
                  {METRICS_WITH_RATIO.has(m) && (
                    <span className="text-[10px] text-muted-foreground/70"> (%)</span>
                  )}
                </th>
              );
            })}
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
          {rows.map((row, idx) => (
            <PnlRow
              key={row.key}
              row={row}
              meta={rowMetas[idx]}
              leftCount={leftHeaders.length}
              dimCount={dimCount}
              highlighted={highlighted.has(row.key)}
              onToggle={() => toggleHighlight(row.key)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface PnlRowProps {
  row: PnlTableRow;
  meta: RowMeta;
  leftCount: number;
  dimCount: number;
  highlighted: boolean;
  onToggle: () => void;
}

function PnlRow({ row, meta, leftCount, dimCount, highlighted, onToggle }: PnlRowProps) {
  const handleClick = (e: React.SyntheticEvent<HTMLTableRowElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, [role="link"]')) return;
    onToggle();
  };

  const groupBorder = meta.isGroupBoundary ? 'border-t-2 border-t-border' : '';
  const summary = row.isSummary ? 'bg-muted/30 font-semibold' : '';
  const hl = highlighted ? 'bg-yellow-100/70 dark:bg-yellow-900/30' : 'hover:bg-muted/30';
  // sticky 셀의 배경. tr의 색을 덮지 않도록 row 상태에 맞춰 직접 지정.
  // 참고: rowspan으로 병합된 owner cell은 다른 행 클릭 시 own 상태를 따른다(병합 그룹 전체 강조 아님)
  const stickyBg = highlighted
    ? 'bg-yellow-100/70 dark:bg-yellow-900/30'
    : row.isSummary
      ? 'bg-muted/30'
      : 'bg-background';

  return (
    <tr
      className={`border-b border-border/50 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${groupBorder} ${summary} ${hl}`}
      tabIndex={0}
      role="button"
      aria-pressed={highlighted}
      aria-label={`${row.labels.join(' / ')} 행 — Enter/Space로 강조 토글`}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick(e);
        }
      }}
    >
      {row.labels.map((lbl, i) => {
        const stickyStyle = {
          left: `${i * STICKY_LEFT_PX}px`,
          minWidth: STICKY_LEFT_PX,
          maxWidth: STICKY_LEFT_PX,
        };
        // 차원 컬럼이면 rowspan 적용. spans[i]===0이면 상위 셀에 흡수돼 렌더 안 함
        if (i < dimCount) {
          const span = meta.spans[i];
          if (span === 0) return null;
          return (
            <td
              key={`l-${i}`}
              rowSpan={span}
              scope="row"
              className={`sticky left-0 z-[5] ${stickyBg} px-2 py-1.5 font-medium align-middle truncate`}
              style={stickyStyle}
              title={lbl}
            >
              {lbl}
            </td>
          );
        }
        // 차원 외 라벨(예: 연도) — 항상 단일 셀
        return (
          <td
            key={`l-${i}`}
            className={`sticky left-0 z-[5] ${stickyBg} px-2 py-1.5 font-medium truncate`}
            style={stickyStyle}
            title={lbl}
          >
            {lbl}
          </td>
        );
      })}
      {/* leftCount > labels.length일 때 빈 칸 채움 */}
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
  const emphasized = metric === 'revenue' || isOpIncome;
  const isNegative = isOpIncome && value < 0;
  const valueColor = isNegative ? 'text-red-500' : 'text-foreground';
  const ratioColor = isNegative ? 'text-red-500' : 'text-muted-foreground';
  const fontWeight = emphasized ? 'font-bold' : '';
  return (
    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
      <div className={`${valueColor} ${fontWeight}`}>{fmtMillion(value)}</div>
      {showRatio && <div className={`text-[10px] ${ratioColor}`}>{fmtRatio(value, revenue)}</div>}
    </td>
  );
}
