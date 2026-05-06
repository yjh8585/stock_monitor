'use client';

import { memo, useState } from 'react';
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
import ProductCell from './ProductCell';
import CustomerBadges from './CustomerBadges';
import NewsModal from './NewsModal';

interface StockRowProps {
  row: RelatedStockRow;
}

/** 주식 상세 팝업 창 열기 (3/4 주식 페이지 + 1/4 뉴스) */
function openPopup(id: string) {
  window.open(`/stock-popup/${id}`, '_blank', 'width=1400,height=900,scrollbars=yes,resizable=yes');
}

const TD = 'px-2 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis';
const NUM_TD = `${TD} text-right tabular-nums`;

/** 고정 열 sticky 스타일 — CSS 변수 --sl-0/1/2 는 부모 <table>에서 주입 */
function frozenStyle(slot: 0 | 1 | 2, bg: string): React.CSSProperties {
  return { position: 'sticky', left: `var(--sl-${slot})`, zIndex: 1, backgroundColor: bg };
}

/** 관련주식 표 단일 행 */
const StockRow = memo(function StockRow({ row }: StockRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  const fy = row.financials_by_year;
  const fx = row.fx_to_krw;

  const rev22 = fy?.['2022']?.revenue ?? null;
  const rev23 = fy?.['2023']?.revenue ?? null;
  const rev24 = fy?.['2024']?.revenue ?? null;
  const rev25 = fy?.['2025']?.revenue ?? null;

  const g23 = growthPct(rev23, rev22);
  const g24 = growthPct(rev24, rev23);
  const g25 = growthPct(rev25, rev24);

  // 3yr CAGR: 22→25 우선, 없으면 23→25 2yr
  const cagr =
    rev22 != null && rev25 != null ? calcCagr(rev22, rev25, 3) : calcCagr(rev23, rev25, 2);

  const invTurn25 = invTurnover(fy?.['2025']);
  const priceLabel = fmtPrice(row.last_price);
  const changeLabel = fmtChange(row.last_change_pct);
  const changeClass = arrowColor(row.last_change_pct);

  const summaryText = row.business_summary ?? '회사 설명이 아직 수집되지 않았습니다. (수집 예정)';

  // 고정 셀 배경: --background/--muted 는 oklch() 형식, hsl() 래핑 금지
  const frozenBg = hovered
    ? 'color-mix(in oklch, var(--muted) 30%, var(--background))'
    : 'var(--background)';

  return (
    <>
      <tr
        className="border-b border-border text-xs align-middle hover:bg-muted/30"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* 구분 — frozen 0 */}
        <td className={TD} style={frozenStyle(0, frozenBg)}>
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
        <td className={TD} style={frozenStyle(1, frozenBg)}>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => row.status !== 'unlisted' && openPopup(row.id)}
              className={`font-medium text-left truncate ${
                row.status === 'delisted'
                  ? 'line-through text-muted-foreground'
                  : row.status === 'active'
                    ? 'text-blue-600 dark:text-blue-400 hover:underline cursor-pointer'
                    : 'cursor-default'
              }`}
            >
              {row.name_kr}
            </button>
            <NewsModal companyId={row.id} companyName={row.name_kr} />
          </div>
        </td>

        {/* 제품 + 펼침 — frozen 2, 우측 그림자 */}
        <td
          className={`${TD} shadow-[2px_0_6px_rgba(0,0,0,0.10)]`}
          style={frozenStyle(2, frozenBg)}
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

        {/* '22 매출 */}
        <td className={NUM_TD}>
          <div>{toB(rev22, fx)}</div>
        </td>

        {/* '23 매출 + 성장률 (vs '22) */}
        <td className={NUM_TD}>
          <div>{toB(rev23, fx)}</div>
          {g23 != null && <div className={`text-[10px] ${arrowColor(g23)}`}>{fmtChange(g23)}</div>}
        </td>

        {/* '24 매출 + 성장률 */}
        <td className={NUM_TD}>
          <div>{toB(rev24, fx)}</div>
          {g24 != null && <div className={`text-[10px] ${arrowColor(g24)}`}>{fmtChange(g24)}</div>}
        </td>

        {/* '25 매출 + 성장률 */}
        <td className={NUM_TD}>
          <div>{toB(rev25, fx)}</div>
          {g25 != null && <div className={`text-[10px] ${arrowColor(g25)}`}>{fmtChange(g25)}</div>}
        </td>

        {/* CAGR */}
        <td className={`${NUM_TD} ${arrowColor(cagr)}`}>{cagr != null ? fmtChange(cagr) : '—'}</td>

        {/* '23 OP% */}
        <td
          className={`${NUM_TD} ${(fy?.['2023']?.operating_margin ?? 0) < 0 ? 'text-red-500' : ''}`}
        >
          {fmtPct(fy?.['2023']?.operating_margin ?? null)}
        </td>

        {/* '24 OP% */}
        <td
          className={`${NUM_TD} ${(fy?.['2024']?.operating_margin ?? 0) < 0 ? 'text-red-500' : ''}`}
        >
          {fmtPct(fy?.['2024']?.operating_margin ?? null)}
        </td>

        {/* '25 OP% */}
        <td
          className={`${NUM_TD} ${(fy?.['2025']?.operating_margin ?? 0) < 0 ? 'text-red-500' : ''}`}
        >
          {fmtPct(fy?.['2025']?.operating_margin ?? null)}
        </td>

        {/* '25 부채비율 */}
        <td className={NUM_TD}>{fmtPct(fy?.['2025']?.debt_ratio ?? null)}</td>

        {/* '25 재고회전율 */}
        <td className={NUM_TD}>{invTurn25 != null ? fmtNum(invTurn25) : '—'}</td>

        {/* 주가 + 등락률 */}
        <td className={NUM_TD}>
          <div>{priceLabel}</div>
          {changeLabel && <div className={`text-[10px] ${changeClass}`}>{changeLabel}</div>}
        </td>

        {/* 시가총액 (조원) */}
        <td className={NUM_TD}>{toT(row.market_cap)}</td>

        {/* PER */}
        <td className={NUM_TD}>{fmtNum(fy?.['2025']?.per ?? null)}</td>

        {/* PBR */}
        <td className={NUM_TD}>{fmtNum(fy?.['2025']?.pbr ?? null)}</td>

        {/* EV/EBITDA */}
        <td className={NUM_TD}>{fmtNum(fy?.['2025']?.ev_ebitda ?? null)}</td>
      </tr>

      {/* 펼침: 회사 설명 (20컬럼 span) */}
      {expanded && (
        <tr className="border-b border-border bg-muted/10">
          <td colSpan={20} className="px-4 py-3 text-xs text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground mr-2">{row.name_kr}</span>
            {summaryText}
          </td>
        </tr>
      )}
    </>
  );
});

export default StockRow;
