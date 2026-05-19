'use client';

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react';

export type SortDir = 'asc' | 'desc';

/** 컬럼 정의 — 페이지별 SortKey 타입을 generic K로 받는다 */
export interface StickyColumn<K extends string> {
  key: K;
  label: string;
  defaultWidth: number;
  /** 컬럼 헤더 hover 시 표시할 설명 — 데이터 기준 등 부가 정보 */
  tooltip?: string;
}

interface StickyTableProps<R, K extends string> {
  rows: R[];
  columns: StickyColumn<K>[];
  /** 좌측 sticky 고정 열 개수 */
  frozenCount: number;
  /** 행 React key */
  getRowKey: (row: R) => string;
  /** 한 행 렌더 (tr) — colCount는 expanded 행 colSpan용 */
  renderRow: (row: R, ctx: { colCount: number }) => React.ReactNode;
  sortKey: K | null;
  sortDir: SortDir;
  onSort: (key: K) => void;
  /** 행 0개일 때 표시 문자열 */
  emptyText?: string;
}

const MIN_COL_WIDTH = 40;

/** sticky 좌측 고정 열용 인라인 스타일 — 페이지 컴포넌트에서 셀 단위로 호출 */
export function stickyLeftStyle(slot: number, bg: string): React.CSSProperties {
  return { position: 'sticky', left: `var(--sl-${slot})`, zIndex: 1, backgroundColor: bg };
}

const SortIcon = memo(function SortIcon<K extends string>({
  colKey,
  sortKey,
  sortDir,
}: {
  colKey: K;
  sortKey: K | null;
  sortDir: SortDir;
}) {
  if (colKey !== sortKey)
    return <ChevronsUpDown size={11} className="inline ml-0.5 text-muted-foreground/50" />;
  return sortDir === 'asc' ? (
    <ChevronUp size={11} className="inline ml-0.5" />
  ) : (
    <ChevronDown size={11} className="inline ml-0.5" />
  );
});

/**
 * 공통 sticky 헤더 + 좌측 N열 고정 + 정렬 + 열 너비 드래그 조정 테이블.
 *
 * 사용처:
 * - 관련회사 페이지(StockTable)
 * - 향후 동일 포맷 페이지 3~5개에서 재사용
 */
export default function StickyTable<R, K extends string>({
  rows,
  columns,
  frozenCount,
  getRowKey,
  renderRow,
  sortKey,
  sortDir,
  onSort,
  emptyText = '조건에 맞는 항목이 없습니다.',
}: StickyTableProps<R, K>) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [colWidths, setColWidths] = useState<number[]>(() => columns.map((c) => c.defaultWidth));

  const scrollDivRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const div = scrollDivRef.current;
    if (!div) return;
    setContainerWidth(div.clientWidth);
    const ro = new ResizeObserver(([entry]) => {
      setContainerWidth(Math.floor(entry.contentRect.width));
    });
    ro.observe(div);
    return () => ro.disconnect();
  }, []);

  const colWidthsRef = useRef(colWidths);
  useEffect(() => {
    colWidthsRef.current = colWidths;
  }, [colWidths]);

  const resizeRef = useRef<{ colIndex: number; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const { colIndex, startX, startWidth } = resizeRef.current;
      const delta = e.clientX - startX;
      setColWidths((prev) => {
        const next = [...prev];
        next[colIndex] = Math.max(MIN_COL_WIDTH, startWidth + delta);
        return next;
      });
    };
    const onMouseUp = () => {
      resizeRef.current = null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!resizeRef.current) return;
      const { colIndex, startX, startWidth } = resizeRef.current;
      const delta = e.touches[0].clientX - startX;
      setColWidths((prev) => {
        const next = [...prev];
        next[colIndex] = Math.max(MIN_COL_WIDTH, startWidth + delta);
        return next;
      });
    };
    const onTouchEnd = () => {
      resizeRef.current = null;
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  const handleResizeMouseDown = useCallback((colIndex: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    resizeRef.current = {
      colIndex,
      startX: e.clientX,
      startWidth: colWidthsRef.current[colIndex],
    };
  }, []);

  const stickyLefts = useMemo(
    () =>
      Array.from({ length: frozenCount }, (_, i) =>
        colWidths.slice(0, i).reduce((a, b) => a + b, 0)
      ),
    [colWidths, frozenCount]
  );

  const totalWidth = useMemo(() => colWidths.reduce((a, b) => a + b, 0), [colWidths]);

  const tableStyle = useMemo(() => {
    const style: Record<string, string | number> = {
      tableLayout: 'fixed',
      width: `${totalWidth}px`,
      '--cw': `${containerWidth}px`,
    };
    for (let i = 0; i < frozenCount; i++) {
      style[`--sl-${i}`] = `${stickyLefts[i] ?? 0}px`;
    }
    return style as React.CSSProperties;
  }, [totalWidth, containerWidth, stickyLefts, frozenCount]);

  return (
    <div
      ref={scrollDivRef}
      className="flex-1 overflow-auto"
      style={{ WebkitOverflowScrolling: 'touch' as const }}
    >
      <table className="text-sm border-collapse" style={tableStyle}>
        <colgroup>
          {columns.map((_, i) => (
            <col key={i} style={{ width: colWidths[i] }} />
          ))}
        </colgroup>

        <thead className="sticky top-0 z-10">
          <tr>
            {columns.map((col, i) => {
              const isFrozen = i < frozenCount;
              const isLastFrozen = i === frozenCount - 1;
              const ariaSort: React.AriaAttributes['aria-sort'] =
                col.key === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
              return (
                <th
                  key={`${col.key}-${i}`}
                  scope="col"
                  aria-sort={ariaSort}
                  style={
                    isFrozen ? { position: 'sticky', left: stickyLefts[i], zIndex: 20 } : undefined
                  }
                  className={`relative px-2 py-2 text-left font-medium text-muted-foreground select-none whitespace-nowrap border-b border-border overflow-hidden backdrop-blur-sm ${
                    isFrozen ? 'bg-muted' : 'bg-muted/80'
                  } ${isLastFrozen ? 'shadow-[2px_0_6px_rgba(0,0,0,0.12)]' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => onSort(col.key)}
                    className="flex items-center gap-0.5 cursor-pointer hover:text-foreground transition-colors w-full text-left"
                    aria-label={`${col.label} 기준으로 정렬`}
                    title={col.tooltip}
                  >
                    <span>{col.label}</span>
                    <SortIcon colKey={col.key} sortKey={sortKey} sortDir={sortDir} />
                  </button>
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`${col.label} 열 너비 조정`}
                    className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40 select-none z-10"
                    onMouseDown={(e) => handleResizeMouseDown(i, e)}
                    onClick={(e) => e.stopPropagation()}
                    onTouchStart={(e) => {
                      e.stopPropagation();
                      const touch = e.touches[0];
                      resizeRef.current = {
                        colIndex: i,
                        startX: touch.clientX,
                        startWidth: colWidths[i],
                      };
                    }}
                  />
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <Fragment key={getRowKey(row)}>{renderRow(row, { colCount: columns.length })}</Fragment>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
