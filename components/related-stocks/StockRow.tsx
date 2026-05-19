'use client';

import { memo, useMemo, useState } from 'react';
import { RelatedStockRow } from '@/lib/types';
import { buildDescription } from '@/lib/financialFormatter';
import { stickyLeftStyle } from '@/components/common/StickyTable';
import {
  CompanyNameCell,
  ExpandedSummaryRow,
  FinancialCells,
  TD,
} from '@/components/common/StockCells';
import ProductCell from './ProductCell';
import CustomerBadges from './CustomerBadges';
import NewsModal from './NewsModal';

interface StockRowProps {
  row: RelatedStockRow;
  latestYear: string;
  colCount: number;
  frozenCount: number;
}

/** 관련주식 표 단일 행 — 좌측 frozen 5칸(구분/회사명/제품/고객사/지역) + 공통 재무 셀 */
const StockRow = memo(function StockRow({ row, latestYear, colCount, frozenCount }: StockRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [highlighted, setHighlighted] = useState(false);

  const handleRowClick = (e: React.SyntheticEvent<HTMLTableRowElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('button, a, input, [role="link"]')) return;
    setHighlighted((v) => !v);
  };

  const description = useMemo(() => buildDescription(row, latestYear), [row, latestYear]);

  const frozenBg = highlighted
    ? 'color-mix(in oklch, oklch(95% 0.18 95) 60%, var(--background))'
    : hovered
      ? 'color-mix(in oklch, var(--muted) 30%, var(--background))'
      : 'var(--background)';

  return (
    <>
      <tr
        className={`border-b border-border text-sm align-middle cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          highlighted ? 'bg-yellow-100/70 dark:bg-yellow-900/30' : 'hover:bg-muted/30'
        }`}
        tabIndex={0}
        role="button"
        aria-pressed={highlighted}
        aria-label={`${row.name_kr} 행 — Enter/Space로 강조 토글`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={handleRowClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleRowClick(e);
          }
        }}
      >
        {/* 구분 — frozen 0 */}
        <td className={TD} style={stickyLeftStyle(0, frozenBg)}>
          <span
            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
              row.company_type === 'OEM'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                : 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
            }`}
          >
            {row.company_type ?? '—'}
          </span>
        </td>

        {/* 회사명 + 뉴스 — frozen 1 */}
        <CompanyNameCell
          row={row}
          stickyLeftStyle={stickyLeftStyle(1, frozenBg)}
          tdClassName={frozenCount === 2 ? 'shadow-[2px_0_6px_rgba(0,0,0,0.10)]' : undefined}
          rightAction={
            <NewsModal
              companyId={row.id}
              companyName={row.name_kr}
              ticker={row.ticker}
              country={row.country}
            />
          }
        />

        {/* 제품 — frozenCount>2일 때만 frozen 2 */}
        <td
          className={`${TD} ${frozenCount > 2 ? 'shadow-[2px_0_6px_rgba(0,0,0,0.10)]' : ''}`}
          style={frozenCount > 2 ? stickyLeftStyle(2, frozenBg) : undefined}
        >
          <ProductCell
            products={row.products}
            expanded={expanded}
            onToggle={() => setExpanded((v) => !v)}
          />
        </td>

        {/* 고객사 (부품사만 표시) */}
        <td className={TD}>
          {row.company_type === '부품사' ? (
            <CustomerBadges customers={row.customers} />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>

        {/* 지역 */}
        <td className={TD}>{row.region ?? '—'}</td>

        <FinancialCells row={row} latestYear={latestYear} />
      </tr>

      {expanded && (
        <ExpandedSummaryRow
          name_kr={row.name_kr}
          colCount={colCount}
          body={
            <>
              {description.summary}
              {description.financial && <span className="block mt-2">{description.financial}</span>}
            </>
          }
        />
      )}
    </>
  );
});

export default StockRow;
