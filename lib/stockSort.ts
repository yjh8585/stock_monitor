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
    { key: 'cagr' as K, label: '3yr CAGR', defaultWidth: 74 },
    ...opYears.map((y) => ({
      key: `op_${y}` as K,
      label: `'${String(y).slice(2)} OP%`,
      defaultWidth: 68,
    })),
    { key: 'debt_ratio' as K, label: `'${y2} 부채비율`, defaultWidth: 80 },
    { key: 'inv_turnover' as K, label: `'${y2} 재고회전율`, defaultWidth: 92 },
    { key: 'last_price' as K, label: '주가', defaultWidth: 80 },
    { key: 'market_cap_t' as K, label: '시가총액', defaultWidth: 72 },
    { key: 'per' as K, label: `'${y2} PER`, defaultWidth: 60 },
    { key: 'pbr' as K, label: `'${y2} PBR`, defaultWidth: 60 },
    { key: 'ev_ebitda' as K, label: `'${y2} EV/EBITDA`, defaultWidth: 90 },
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

  if (key.startsWith('rev_')) return revKrw(key.slice(4));
  if (key.startsWith('op_')) return fy?.[key.slice(3)]?.operating_margin ?? null;

  switch (key) {
    case 'cagr': {
      const r3ago = revKrw(String(yr - 3));
      const rLatest = revKrw(latestYear);
      if (r3ago != null && rLatest != null) return calcCagr(r3ago, rLatest, 3);
      return calcCagr(revKrw(String(yr - 2)), rLatest, 2);
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
