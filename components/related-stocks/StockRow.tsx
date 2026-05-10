'use client';

import { memo, useMemo, useState } from 'react';
import { RelatedStockRow } from '@/lib/types';
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
import { buildDescription } from '@/lib/financialFormatter';
import { stickyLeftStyle } from '@/components/common/StickyTable';
import ProductCell from './ProductCell';
import CustomerBadges from './CustomerBadges';
import NewsModal from './NewsModal';

interface StockRowProps {
  row: RelatedStockRow;
  latestYear: string;
  colCount: number;
}

const POPUP_OPTS = 'width=1400,height=900,scrollbars=yes,resizable=yes';

/** 회사명 클릭 동작 */
function openCompanyLink(row: RelatedStockRow) {
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

const TD = 'px-2 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis';
const NUM_TD = `${TD} text-right tabular-nums`;

/** 관련주식 표 단일 행 */
const StockRow = memo(function StockRow({ row, latestYear, colCount }: StockRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [highlighted, setHighlighted] = useState(false);

  // 셀 빈 공간 클릭/키보드 토글. 버튼/링크/입력 등은 자체 동작 우선.
  const handleRowClick = (e: React.SyntheticEvent<HTMLTableRowElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('button, a, input, [role="link"]')) return;
    setHighlighted((v) => !v);
  };

  const fy = row.financials_by_year;
  // 매출 환산은 재무제표 통화 기준 fx (VFS=USD주가/VND재무 같은 케이스 대응)
  const fx = row.fx_fin_to_krw ?? row.fx_to_krw;

  const yr = parseInt(latestYear);
  // 최근 3년 매출 연도 (표시용)
  const recentRevYears = [String(yr - 2), String(yr - 1), String(yr)];

  // CAGR: 3년전→최근 우선, 없으면 2년전→최근
  const revLatest = fy?.[latestYear]?.revenue ?? null;
  const rev3ago = fy?.[String(yr - 3)]?.revenue ?? null;
  const rev2ago = fy?.[String(yr - 2)]?.revenue ?? null;
  const cagr =
    rev3ago != null && revLatest != null
      ? calcCagr(rev3ago, revLatest, 3)
      : calcCagr(rev2ago, revLatest, 2);

  // 부채비율 / 재고회전율 — latestYear에 값이 없으면 직전 연도까지 fallback (수집은 연도별로 계속 유지)
  const fallbackYears = [latestYear, String(yr - 1), String(yr - 2), String(yr - 3)];
  const debtRatioLatest =
    fallbackYears.map((y) => fy?.[y]?.debt_ratio).find((v) => v != null) ?? null;
  const invTurnLatest =
    fallbackYears.map((y) => invTurnover(fy?.[y])).find((v) => v != null) ?? null;

  const priceLabel = fmtPrice(row.last_price);
  const changeLabel = fmtChange(row.last_change_pct);
  const changeClass = arrowColor(row.last_change_pct);

  const description = useMemo(() => buildDescription(row, latestYear), [row, latestYear]);

  // 행 배경 우선순위: highlighted(클릭 토글) > hovered > 기본
  const frozenBg = highlighted
    ? 'color-mix(in oklch, oklch(95% 0.18 95) 60%, var(--background))'
    : hovered
      ? 'color-mix(in oklch, var(--muted) 30%, var(--background))'
      : 'var(--background)';

  const isUnlisted = !row.market;

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

        {/* 고객사 */}
        <td className={TD}>
          {row.company_type === '부품사' ? (
            <CustomerBadges customers={row.customers} />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>

        {/* 지역 */}
        <td className={TD}>{row.region ?? '—'}</td>

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

        {/* 부채비율 (값 있는 최근 연도) */}
        <td className={NUM_TD}>{fmtPct(debtRatioLatest)}</td>

        {/* 재고회전율 (값 있는 최근 연도) */}
        <td className={NUM_TD}>{invTurnLatest != null ? fmtNum(invTurnLatest) : '—'}</td>

        {/* 주가 + 등락률 */}
        <td className={NUM_TD}>
          <div>{priceLabel}</div>
          {changeLabel && <div className={`text-[10px] ${changeClass}`}>{changeLabel}</div>}
        </td>

        {/* 시가총액 (조원) */}
        <td className={NUM_TD}>{toT(row.market_cap)}</td>

        {/* PER */}
        <td className={NUM_TD}>{fmtNum(fy?.[latestYear]?.per ?? null)}</td>

        {/* PBR */}
        <td className={NUM_TD}>{fmtNum(fy?.[latestYear]?.pbr ?? null)}</td>

        {/* EV/EBITDA */}
        <td className={NUM_TD}>{fmtNum(fy?.[latestYear]?.ev_ebitda ?? null)}</td>
      </tr>

      {expanded && (
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
                {description.summary}
              </p>
              {description.financial && <p className="mt-2">{description.financial}</p>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
});

export default StockRow;
