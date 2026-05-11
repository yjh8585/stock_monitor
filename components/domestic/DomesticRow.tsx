'use client';

import { memo, useState } from 'react';
import { DomesticStockRow } from '@/lib/types';
import { stickyLeftStyle } from '@/components/common/StickyTable';
import {
  CompanyNameCell,
  ExpandedSummaryRow,
  FinancialCells,
  TD,
} from '@/components/common/StockCells';
import ProductCell from '@/components/related-stocks/ProductCell';
import CustomerBadges from '@/components/related-stocks/CustomerBadges';
import NewsModal from '@/components/related-stocks/NewsModal';

interface DomesticRowProps {
  row: DomesticStockRow;
  latestYear: string;
  colCount: number;
}

const GROUP_BADGE_PALETTE = [
  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
];

/** 그룹명 → 미리 정의된 팔레트 색상. 같은 그룹은 같은 색. */
function groupBadgeStyle(group: string | null): string {
  if (!group) return 'bg-muted text-muted-foreground';
  let h = 0;
  for (let i = 0; i < group.length; i++) h = (h * 31 + group.charCodeAt(i)) % 360;
  return GROUP_BADGE_PALETTE[h % GROUP_BADGE_PALETTE.length];
}

/** 국내자동차 표 단일 행 — 좌측 frozen 4칸(그룹/회사명/제품/고객사) + 공통 재무 셀 */
const DomesticRow = memo(function DomesticRow({ row, latestYear, colCount }: DomesticRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [highlighted, setHighlighted] = useState(false);

  const handleRowClick = (e: React.SyntheticEvent<HTMLTableRowElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('button, a, input, [role="button"], [role="link"]')) return;
    setHighlighted((v) => !v);
  };

  const summary = row.business_summary ?? '';

  const frozenBg = highlighted
    ? 'color-mix(in oklch, oklch(95% 0.18 95) 60%, var(--background))'
    : hovered
      ? 'color-mix(in oklch, var(--muted) 30%, var(--background))'
      : 'var(--background)';

  return (
    <>
      <tr
        className={`border-b border-border text-xs align-middle cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
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
        {/* 그룹 — frozen 0 (매출 순위 + 그룹 뱃지) */}
        <td className={TD} style={stickyLeftStyle(0, frozenBg)}>
          <div className="flex items-center gap-1.5">
            {row.sales_rank != null && (
              <span className="text-[11px] tabular-nums text-muted-foreground shrink-0 w-5 text-right">
                {row.sales_rank}
              </span>
            )}
            {row.group_name && (
              <span
                className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${groupBadgeStyle(row.group_name)}`}
              >
                {row.group_name}
              </span>
            )}
          </div>
        </td>

        {/* 회사명 + 뉴스 — frozen 1 */}
        <CompanyNameCell
          row={row}
          stickyLeftStyle={stickyLeftStyle(1, frozenBg)}
          rightAction={
            <NewsModal
              companyId={row.id}
              companyName={row.name_kr}
              ticker={row.ticker}
              country={row.country}
            />
          }
        />

        {/* 제품 + 펼침 — frozen 2 */}
        <td
          className={`${TD} shadow-[2px_0_6px_rgba(0,0,0,0.10)]`}
          style={stickyLeftStyle(2, frozenBg)}
        >
          <ProductCell
            products={row.products}
            expanded={expanded}
            onToggle={() => setExpanded((v) => !v)}
          />
        </td>

        {/* 고객사 (모두 부품사) */}
        <td className={TD}>
          <CustomerBadges customers={row.customers} />
        </td>

        <FinancialCells row={row} latestYear={latestYear} />
      </tr>

      {expanded && summary && (
        <ExpandedSummaryRow name_kr={row.name_kr} colCount={colCount} body={summary} />
      )}
    </>
  );
});

export default DomesticRow;
