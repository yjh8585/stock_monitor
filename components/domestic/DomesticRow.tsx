'use client';

import { memo, useMemo, useState } from 'react';
import { DomesticStockRow } from '@/lib/types';
import {
  toB,
  toT,
  fmtPct,
  fmtNum,
  fmtPrice,
  fmtChange,
  growthPct,
  calcCagr,
  invTurnover,
  arrowColor,
} from '@/lib/format';
import { stickyLeftStyle } from '@/components/common/StickyTable';
import ProductCell from '@/components/related-stocks/ProductCell';
import CustomerBadges from '@/components/related-stocks/CustomerBadges';
import NewsModal from '@/components/related-stocks/NewsModal';

interface DomesticRowProps {
  row: DomesticStockRow;
  latestYear: string;
  colCount: number;
}

const POPUP_OPTS = 'width=1400,height=900,scrollbars=yes,resizable=yes';
const TD = 'px-2 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis';
const NUM_TD = `${TD} text-right tabular-nums`;

/** 그룹명 → 배경/글자색 (hash → HSL). 같은 그룹은 같은 색. */
function groupBadgeStyle(group: string | null): string {
  if (!group) return 'bg-muted text-muted-foreground';
  let h = 0;
  for (let i = 0; i < group.length; i++) h = (h * 31 + group.charCodeAt(i)) % 360;
  // Tailwind dynamic class 가 안 되므로 inline style 대신 미리 정의된 팔레트 분기
  const palette = [
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
  return palette[h % palette.length];
}

function openCompanyLink(row: DomesticStockRow): void {
  if (!row.market) {
    if (row.homepage_url) window.open(row.homepage_url, '_blank', POPUP_OPTS);
    return;
  }
  if (row.country === 'KR') {
    window.open(`/stock-popup/${row.id}`, '_blank', POPUP_OPTS);
  } else {
    window.open(`https://finance.yahoo.com/quote/${row.ticker ?? ''}`, '_blank', POPUP_OPTS);
  }
}

const DomesticRow = memo(function DomesticRow({ row, latestYear, colCount }: DomesticRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [highlighted, setHighlighted] = useState(false);

  const handleRowClick = (e: React.MouseEvent<HTMLTableRowElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('button, a, input, [role="button"], [role="link"]')) return;
    setHighlighted((v) => !v);
  };

  const fy = row.financials_by_year;
  const fx = row.fx_fin_to_krw ?? row.fx_to_krw;
  const yr = parseInt(latestYear);
  const recentRevYears = [String(yr - 2), String(yr - 1), String(yr)];

  const revLatest = fy?.[latestYear]?.revenue ?? null;
  const rev3ago = fy?.[String(yr - 3)]?.revenue ?? null;
  const rev2ago = fy?.[String(yr - 2)]?.revenue ?? null;
  const cagr =
    rev3ago != null && revLatest != null
      ? calcCagr(rev3ago, revLatest, 3)
      : calcCagr(rev2ago, revLatest, 2);

  const fallbackYears = [latestYear, String(yr - 1), String(yr - 2), String(yr - 3)];
  const debtRatioLatest =
    fallbackYears.map((y) => fy?.[y]?.debt_ratio).find((v) => v != null) ?? null;
  const invTurnLatest =
    fallbackYears.map((y) => invTurnover(fy?.[y])).find((v) => v != null) ?? null;

  const priceLabel = fmtPrice(row.last_price);
  const changeLabel = fmtChange(row.last_change_pct);
  const changeClass = arrowColor(row.last_change_pct);

  const summary = useMemo(() => row.business_summary ?? '', [row.business_summary]);

  const frozenBg = highlighted
    ? 'color-mix(in oklch, oklch(95% 0.18 95) 60%, var(--background))'
    : hovered
      ? 'color-mix(in oklch, var(--muted) 30%, var(--background))'
      : 'var(--background)';

  const isUnlisted = !row.market;

  return (
    <>
      <tr
        className={`border-b border-border text-xs align-middle cursor-pointer ${
          highlighted ? 'bg-yellow-100/70 dark:bg-yellow-900/30' : 'hover:bg-muted/30'
        }`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={handleRowClick}
      >
        {/* 그룹 — frozen 0 */}
        <td className={TD} style={stickyLeftStyle(0, frozenBg)}>
          {row.group_name ? (
            <span
              className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${groupBadgeStyle(row.group_name)}`}
            >
              {row.group_name}
            </span>
          ) : null}
        </td>

        {/* 회사명 + 뉴스 — frozen 1 */}
        <td className={TD} style={stickyLeftStyle(1, frozenBg)}>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => openCompanyLink(row)}
              className={`font-medium text-left truncate ${
                row.status === 'delisted'
                  ? 'line-through text-muted-foreground cursor-default'
                  : !isUnlisted
                    ? 'text-blue-600 dark:text-blue-400 hover:underline cursor-pointer'
                    : row.homepage_url
                      ? 'text-foreground hover:underline cursor-pointer'
                      : 'text-muted-foreground cursor-default'
              }`}
            >
              {row.name_kr}
            </button>
            <NewsModal
              companyId={row.id}
              companyName={row.name_kr}
              ticker={row.ticker}
              country={row.country}
            />
          </div>
        </td>

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

        {/* 최근 3년 매출 */}
        {recentRevYears.map((year) => {
          const rev = fy?.[year]?.revenue ?? null;
          const prevRev = fy?.[String(parseInt(year) - 1)]?.revenue ?? null;
          const g = growthPct(rev, prevRev);
          return (
            <td key={`rev-${year}`} className={NUM_TD}>
              <div>{toB(rev, fx)}</div>
              {g != null && <div className={`text-[10px] ${arrowColor(g)}`}>{fmtChange(g)}</div>}
            </td>
          );
        })}

        {/* CAGR */}
        <td className={`${NUM_TD} ${arrowColor(cagr)}`}>{cagr != null ? fmtChange(cagr) : '—'}</td>

        {/* 최근 3년 OP% */}
        {recentRevYears.map((year) => (
          <td
            key={`op-${year}`}
            className={`${NUM_TD} ${(fy?.[year]?.operating_margin ?? 0) < 0 ? 'text-red-500' : ''}`}
          >
            {fmtPct(fy?.[year]?.operating_margin ?? null)}
          </td>
        ))}

        <td className={NUM_TD}>{fmtPct(debtRatioLatest)}</td>
        <td className={NUM_TD}>{invTurnLatest != null ? fmtNum(invTurnLatest) : '—'}</td>

        <td className={NUM_TD}>
          <div>{priceLabel}</div>
          {changeLabel && <div className={`text-[10px] ${changeClass}`}>{changeLabel}</div>}
        </td>
        <td className={NUM_TD}>{toT(row.market_cap)}</td>
        <td className={NUM_TD}>{fmtNum(fy?.[latestYear]?.per ?? null)}</td>
        <td className={NUM_TD}>{fmtNum(fy?.[latestYear]?.pbr ?? null)}</td>
        <td className={NUM_TD}>{fmtNum(fy?.[latestYear]?.ev_ebitda ?? null)}</td>
      </tr>

      {expanded && summary && (
        <tr className="border-b border-border">
          <td colSpan={colCount} className="p-0">
            <div
              className="px-4 py-3 text-sm text-foreground leading-relaxed bg-muted/10"
              style={{
                position: 'sticky',
                left: 0,
                width: 'var(--cw)',
                boxSizing: 'border-box',
                zIndex: 2,
              }}
            >
              <p>
                <span className="font-medium mr-2">{row.name_kr}</span>
                {summary}
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
});

export default DomesticRow;
