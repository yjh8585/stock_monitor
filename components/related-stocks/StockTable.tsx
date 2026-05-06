'use client';

import { useMemo, useState, useRef, useEffect, useCallback, memo } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { RelatedStockRow, SortKey, SortDir } from '@/lib/types';
import { calcCagr, invTurnover } from '@/lib/format';
import FilterBar, { CompanyTypeFilter } from './FilterBar';
import StockRow from './StockRow';

interface StockTableProps {
  rows: RelatedStockRow[];
}

interface ColDef {
  key: SortKey;
  label: string;
  defaultWidth: number;
  frozen?: boolean;
}

/** 고정 열 수 (구분 / 회사명 / 제품) */
const FROZEN_COUNT = 3;

const COLUMNS: ColDef[] = [
  { key: 'company_type', label: '구분', defaultWidth: 58, frozen: true },
  { key: 'name_kr', label: '회사명', defaultWidth: 104, frozen: true },
  { key: 'name_kr', label: '제품', defaultWidth: 140, frozen: true },
  { key: 'name_kr', label: '고객사', defaultWidth: 130 },
  { key: 'region', label: '지역', defaultWidth: 60 },
  { key: 'rev_2022', label: "'22 매출", defaultWidth: 80 },
  { key: 'rev_2023', label: "'23 매출", defaultWidth: 88 },
  { key: 'rev_2024', label: "'24 매출", defaultWidth: 88 },
  { key: 'rev_2025', label: "'25 매출", defaultWidth: 88 },
  { key: 'cagr', label: '3yr CAGR', defaultWidth: 74 },
  { key: 'op_2023', label: "'23 OP%", defaultWidth: 68 },
  { key: 'op_2024', label: "'24 OP%", defaultWidth: 68 },
  { key: 'op_2025', label: "'25 OP%", defaultWidth: 68 },
  { key: 'debt_ratio', label: "'25 부채비율", defaultWidth: 80 },
  { key: 'inv_turnover', label: "'25 재고회전율", defaultWidth: 92 },
  { key: 'last_price', label: '주가', defaultWidth: 80 },
  { key: 'market_cap_t', label: '시가총액', defaultWidth: 72 },
  { key: 'per', label: 'PER', defaultWidth: 52 },
  { key: 'pbr', label: 'PBR', defaultWidth: 52 },
  { key: 'ev_ebitda', label: 'EV/EBITDA', defaultWidth: 80 },
];

/** 행에서 정렬용 숫자 추출 */
function getSortValue(row: RelatedStockRow, key: SortKey): string | number | null {
  const fy = row.financials_by_year;
  const fx = row.fx_to_krw ?? 1;

  const revKrw = (year: string) => {
    const r = fy?.[year]?.revenue;
    return r != null ? r * fx : null;
  };

  switch (key) {
    case 'company_type':
      return row.company_type ?? '';
    case 'name_kr':
      return row.name_kr;
    case 'region':
      return row.region ?? '';
    case 'rev_2022':
      return revKrw('2022');
    case 'rev_2023':
      return revKrw('2023');
    case 'rev_2024':
      return revKrw('2024');
    case 'rev_2025':
      return revKrw('2025');
    case 'cagr': {
      const r22 = revKrw('2022');
      const r25 = revKrw('2025');
      if (r22 != null && r25 != null) return calcCagr(r22, r25, 3);
      return calcCagr(revKrw('2023'), r25, 2);
    }
    case 'op_2023':
      return fy?.['2023']?.operating_margin ?? null;
    case 'op_2024':
      return fy?.['2024']?.operating_margin ?? null;
    case 'op_2025':
      return fy?.['2025']?.operating_margin ?? null;
    case 'debt_ratio':
      return fy?.['2025']?.debt_ratio ?? null;
    case 'inv_turnover':
      return invTurnover(fy?.['2025']);
    case 'last_price':
      return row.last_price != null ? row.last_price * fx : null;
    case 'market_cap_t':
      return row.market_cap;
    case 'per':
      return fy?.['2025']?.per ?? null;
    case 'pbr':
      return fy?.['2025']?.pbr ?? null;
    case 'ev_ebitda':
      return fy?.['2025']?.ev_ebitda ?? null;
    default:
      return null;
  }
}

const SortIcon = memo(function SortIcon({
  colKey,
  sortKey,
  sortDir,
}: {
  colKey: SortKey;
  sortKey: SortKey | null;
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

/** 관련주식 20컬럼 표 (정렬 · 필터 · 열 너비 조정 · 좌측 3열 고정) */
export default function StockTable({ rows }: StockTableProps) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [typeFilter, setTypeFilter] = useState<CompanyTypeFilter[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [colWidths, setColWidths] = useState<number[]>(() => COLUMNS.map((c) => c.defaultWidth));

  // 현재 colWidths를 ref로 유지해 resize 핸들러에서 최신값 참조
  const colWidthsRef = useRef(colWidths);
  useEffect(() => {
    colWidthsRef.current = colWidths;
  }, [colWidths]);

  const resizeRef = useRef<{ colIndex: number; startX: number; startWidth: number } | null>(null);

  // 문서 레벨 mouse 이벤트로 드래그 리사이즈 처리
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const { colIndex, startX, startWidth } = resizeRef.current;
      const delta = e.clientX - startX;
      setColWidths((prev) => {
        const next = [...prev];
        next[colIndex] = Math.max(40, startWidth + delta);
        return next;
      });
    };
    const onMouseUp = () => {
      resizeRef.current = null;
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
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

  // 고정 열의 sticky left 값 (CSS 변수로 전달)
  const stickyLefts = useMemo(
    () =>
      Array.from({ length: FROZEN_COUNT }, (_, i) =>
        colWidths.slice(0, i).reduce((a, b) => a + b, 0)
      ),
    [colWidths]
  );

  const totalWidth = colWidths.reduce((a, b) => a + b, 0);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const handleTypeToggle = (type: CompanyTypeFilter) => {
    setTypeFilter((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const filtered = useMemo(() => {
    let result = rows;
    if (typeFilter.length > 0) {
      result = result.filter(
        (r) => r.company_type && typeFilter.includes(r.company_type as CompanyTypeFilter)
      );
    }
    if (productQuery.trim()) {
      const q = productQuery.trim().toLowerCase();
      result = result.filter((r) => r.products.some((p) => p.name.toLowerCase().includes(q)));
    }
    return result;
  }, [rows, typeFilter, productQuery]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  return (
    <div className="flex flex-col h-full">
      <FilterBar
        typeFilter={typeFilter}
        productQuery={productQuery}
        onTypeToggle={handleTypeToggle}
        onProductChange={setProductQuery}
      />
      <div className="flex-1 overflow-auto">
        {/* CSS 변수로 고정 열 left 위치 전달 → StockRow 재렌더 없이 CSS 캐스케이드로 적용 */}
        <table
          className="text-xs border-collapse"
          style={
            {
              tableLayout: 'fixed',
              width: `${totalWidth}px`,
              '--sl-0': `${stickyLefts[0]}px`,
              '--sl-1': `${stickyLefts[1]}px`,
              '--sl-2': `${stickyLefts[2]}px`,
            } as React.CSSProperties
          }
        >
          <colgroup>
            {COLUMNS.map((_, i) => (
              <col key={i} style={{ width: colWidths[i] }} />
            ))}
          </colgroup>

          <thead className="sticky top-0 z-10">
            <tr>
              {COLUMNS.map((col, i) => {
                const isFrozen = i < FROZEN_COUNT;
                const isLastFrozen = i === FROZEN_COUNT - 1;
                return (
                  <th
                    key={`${col.key}-${i}`}
                    onClick={() => handleSort(col.key)}
                    style={
                      isFrozen
                        ? { position: 'sticky', left: stickyLefts[i], zIndex: 20 }
                        : undefined
                    }
                    className={`relative px-2 py-2 text-left font-medium text-muted-foreground cursor-pointer select-none whitespace-nowrap border-b border-border hover:text-foreground transition-colors overflow-hidden backdrop-blur-sm ${
                      isFrozen ? 'bg-muted' : 'bg-muted/80'
                    } ${isLastFrozen ? 'shadow-[2px_0_6px_rgba(0,0,0,0.12)]' : ''}`}
                  >
                    <span>{col.label}</span>
                    <SortIcon colKey={col.key} sortKey={sortKey} sortDir={sortDir} />
                    {/* 열 너비 조정 핸들: onClick stopPropagation으로 정렬 방지 */}
                    <div
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40 select-none z-10"
                      onMouseDown={(e) => handleResizeMouseDown(i, e)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {sorted.map((row) => (
              <StockRow key={row.id} row={row} />
            ))}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  조건에 맞는 항목이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
