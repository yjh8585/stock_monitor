'use client';

/**
 * StockRow / DomesticRow에서 공유하는 셀 헬퍼.
 * 좌측 frozen 컬럼은 페이지마다 다르므로 각 Row가 자체 구현하고,
 * 우측 재무·주가 컬럼들(매출 3년 + CAGR + OP% 3년 + 부채/재고/주가/시총/PER/PBR/EV)을
 * 여기서 통합 처리한다.
 */
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
import { openCompanyLink } from '@/lib/companyLink';
import type { FinancialRowBase } from '@/lib/stockSort';

const TD = 'px-2 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis';
const NUM_TD = `${TD} text-right tabular-nums`;

interface FinancialCellsProps {
  row: FinancialRowBase;
  latestYear: string;
}

/** 매출 3년 + CAGR + OP% 3년 + 부채/재고/주가/시총/PER/PBR/EV (총 14 td) */
export function FinancialCells({ row, latestYear }: FinancialCellsProps) {
  const fy = row.financials_by_year;
  const fx = row.fx_fin_to_krw ?? row.fx_to_krw;
  const yr = parseInt(latestYear);
  const recentRevYears = [String(yr - 2), String(yr - 1), String(yr)];

  const revLatest = fy?.[latestYear]?.revenue ?? null;
  const rev2ago = fy?.[String(yr - 2)]?.revenue ?? null;
  // 표시 3개 연도(yr-2, yr-1, yr) 기준 2년 CAGR
  const cagr = calcCagr(rev2ago, revLatest, 2);

  // 부채비율/재고회전율 — latestYear 비면 직전 연도 fallback
  const fallbackYears = [latestYear, String(yr - 1), String(yr - 2), String(yr - 3)];
  const debtRatioLatest =
    fallbackYears.map((y) => fy?.[y]?.debt_ratio).find((v) => v != null) ?? null;
  const invTurnLatest =
    fallbackYears.map((y) => invTurnover(fy?.[y])).find((v) => v != null) ?? null;

  const priceLabel = fmtPrice(row.last_price);
  const changeLabel = fmtChange(row.last_change_pct);
  const changeClass = arrowColor(row.last_change_pct);

  return (
    <>
      {/* 매출 3년 */}
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
      {/* OP% 3년 */}
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
      {/* 주가 + 등락 */}
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
    </>
  );
}

interface ExpandedSummaryRowProps {
  name_kr: string;
  /** 펼침 행에 보여줄 본문 (페이지마다 다른 가공) */
  body: React.ReactNode;
  colCount: number;
}

/** 행 펼침 시 표시되는 본문 행 (sticky left + colSpan 전체) */
export function ExpandedSummaryRow({ name_kr, body, colCount }: ExpandedSummaryRowProps) {
  return (
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
            <span className="font-medium mr-2">{name_kr}</span>
            {body}
          </p>
        </div>
      </td>
    </tr>
  );
}

interface CompanyNameCellProps {
  row: {
    id: string;
    ticker: string | null;
    name_kr: string;
    country: string;
    market: string | null;
    status: string;
    homepage_url: string | null;
  };
  /** sticky left 0 / 1 / 2 등의 인덱스 */
  stickyLeftStyle: React.CSSProperties;
  /** 회사명 우측에 띄울 액션 (예: NewsModal). null 시 생략. */
  rightAction?: React.ReactNode;
}

/** 회사명 셀 — 클릭 시 stock-popup/yahoo/homepage 새 창. delisted/비상장 스타일 분기 */
export function CompanyNameCell({ row, stickyLeftStyle, rightAction }: CompanyNameCellProps) {
  const isUnlisted = !row.market;
  const linkClass =
    row.status === 'delisted'
      ? 'line-through text-muted-foreground cursor-default'
      : !isUnlisted
        ? 'text-blue-600 dark:text-blue-400 hover:underline cursor-pointer'
        : row.homepage_url
          ? 'text-foreground hover:underline cursor-pointer'
          : 'text-muted-foreground cursor-default';

  return (
    <td className={TD} style={stickyLeftStyle}>
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => openCompanyLink(row)}
          className={`font-medium text-left truncate ${linkClass}`}
        >
          {row.name_kr}
        </button>
        {rightAction}
      </div>
    </td>
  );
}

export { TD, NUM_TD };
