/**
 * 관련회사 / 국내자동차 / 부품사 TOP100 등 매출·재무 표 페이지에서 공통 사용하는
 * 컬럼 정의 + 정렬 값 추출 + 최근 연도 결정 헬퍼.
 *
 * 페이지마다 SortKey 타입이 다르고 (`SortKey` / `DomesticSortKey` 등), 좌측 프로즌
 * 컬럼이 다르지만 매출/CAGR/OP%/부채비율/재고회전율/주가/시총/PER/PBR/EV/EBITDA
 * 9~10개 우측 컬럼은 모두 동일하다.
 */
import { calcCagr, invTurnover } from './format';
import type { FinancialYear } from './types';
import type { StickyColumn } from '@/components/common/StickyTable';

/** 두 페이지의 Row가 공통으로 가진 재무·주가 필드 */
export interface FinancialRowBase {
  financials_by_year: Record<string, FinancialYear> | null;
  fx_to_krw: number | null;
  fx_fin_to_krw: number | null;
  last_price: number | null;
  last_change_pct: number | null;
  market_cap: number | null;
}

const SUPPORTED_YEARS = ['2026', '2025', '2024', '2023'] as const;
const FALLBACK_YEAR = '2025';

/** 데이터가 존재하는 가장 최근 연도 결정 (revenue 기준) */
export function resolveLatestYear<R extends FinancialRowBase>(rows: R[]): string {
  for (const year of SUPPORTED_YEARS) {
    if (rows.some((r) => r.financials_by_year?.[year]?.revenue != null)) return year;
  }
  return FALLBACK_YEAR;
}

/**
 * 공통 재무·주가 컬럼 묶음 (매출 3년 + CAGR + OP 3년 + 부채/재고/주가/시총/PER/PBR/EV).
 * SortKey가 페이지별로 다른 generic 타입이므로 generic K로 받는다.
 */
export function buildFinancialColumns<K extends string>(latestYear: string): StickyColumn<K>[] {
  const yr = parseInt(latestYear);
  const y2 = latestYear.slice(2);
  const revYears = [yr - 2, yr - 1, yr];
  const opYears = [yr - 2, yr - 1, yr];

  return [
    ...revYears.map((y) => ({
      key: `rev_${y}` as K,
      label: `'${String(y).slice(2)} 매출`,
      defaultWidth: 88,
    })),
    { key: 'cagr' as K, label: `CAGR(${String(yr - 2).slice(2)}→${y2})`, defaultWidth: 80 },
    ...opYears.map((y) => ({
      key: `op_${y}` as K,
      label: `'${String(y).slice(2)} OP%`,
      defaultWidth: 68,
    })),
    { key: 'debt_ratio' as K, label: `'${y2} 부채비율`, defaultWidth: 80 },
    { key: 'inv_turnover' as K, label: `'${y2} 재고회전율`, defaultWidth: 92 },
    { key: 'last_price' as K, label: '주가', defaultWidth: 80 },
    { key: 'market_cap_t' as K, label: '시가총액', defaultWidth: 72 },
    // PER/PBR/EV/EBITDA: 연도 표기 제거 — 국내 fnguide는 연도별, 외국 yfinance는 TTM 스냅샷이라 기준이 다름.
    // 헤더 hover 시 tooltip으로 기준 명시.
    {
      key: 'per' as K,
      label: 'PER',
      defaultWidth: 60,
      tooltip: `국내 상장사: ${latestYear} 회계연도 종가 / 연간 EPS (fnguide)\n해외 상장사: 현재 주가 / TTM EPS (yfinance trailingPE)`,
    },
    {
      key: 'pbr' as K,
      label: 'PBR',
      defaultWidth: 60,
      tooltip: `국내 상장사: ${latestYear} 회계연도 종가 / BPS (fnguide)\n해외 상장사: 현재 주가 / 최근분기 BPS (yfinance priceToBook)`,
    },
    {
      key: 'ev_ebitda' as K,
      label: 'EV/EBITDA',
      defaultWidth: 90,
      tooltip: `국내 상장사: ${latestYear} 회계연도 기준 (fnguide)\n해외 상장사: 현재 EV / TTM EBITDA (yfinance enterpriseToEbitda)`,
    },
  ];
}

/**
 * 공통 재무·주가 SortKey에 대한 값 추출.
 * 페이지 고유 SortKey(company_type, region, group_name 등)는 호출 측에서 먼저 분기 후
 * 공통 case에 해당하는 키만 이 함수로 위임한다.
 *
 * 반환:
 *  - 공통 SortKey 매칭: number | null
 *  - 미매칭(undefined): 호출 측이 페이지 고유 분기로 처리해야 함을 의미
 */
export function getFinancialSortValue<R extends FinancialRowBase>(
  row: R,
  key: string,
  latestYear: string
): number | null | undefined {
  const fy = row.financials_by_year;
  const fxFin = row.fx_fin_to_krw ?? row.fx_to_krw ?? 1;
  const fxPrice = row.fx_to_krw ?? 1;
  const yr = parseInt(latestYear);

  const revKrw = (year: string) => {
    const r = fy?.[year]?.revenue;
    return r != null ? r * fxFin : null;
  };

  if (key.startsWith('rev_')) {
    const year = key.slice(4);
    const direct = revKrw(year);
    if (direct != null) return direct;
    // 최신 연도(rev_${latestYear})만 fallback: 회사별 가장 최근 가용 annual revenue.
    // 예: UzAuto Motors는 매년 5월 IFRS PDF 발행 → 2025 annual은 2026년에 나옴 → rev_2025=null.
    // domestic/parts_top100_view의 latest_revenue_krw 패턴과 동일한 정렬 정책.
    if (year === latestYear && fy) {
      let bestYear: string | null = null;
      for (const y of Object.keys(fy)) {
        if (fy[y]?.revenue == null) continue;
        if (bestYear == null || y > bestYear) bestYear = y;
      }
      if (bestYear != null) {
        const r = fy[bestYear].revenue;
        return r != null ? r * fxFin : null;
      }
    }
    return null;
  }
  if (key.startsWith('op_')) return fy?.[key.slice(3)]?.operating_margin ?? null;

  switch (key) {
    case 'cagr': {
      // 표시 3개 연도(yr-2, yr-1, yr) 기준 2년 CAGR: (yr / yr-2)^(1/2) - 1
      const r2ago = revKrw(String(yr - 2));
      const rLatest = revKrw(latestYear);
      return calcCagr(r2ago, rLatest, 2);
    }
    case 'debt_ratio':
      return fy?.[latestYear]?.debt_ratio ?? null;
    case 'inv_turnover':
      return invTurnover(fy?.[latestYear]);
    case 'last_price':
      return row.last_price != null ? row.last_price * fxPrice : null;
    case 'market_cap_t':
      return row.market_cap;
    case 'per':
      return fy?.[latestYear]?.per ?? null;
    case 'pbr':
      return fy?.[latestYear]?.pbr ?? null;
    case 'ev_ebitda':
      return fy?.[latestYear]?.ev_ebitda ?? null;
    default:
      return undefined; // 호출 측 분기 필요
  }
}
