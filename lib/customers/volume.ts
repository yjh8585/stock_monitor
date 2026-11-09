import type { CompanySaleRowWithPt, OemSalesGroupMonth } from '@/lib/types';

/**
 * MarkLines 그룹 월 판매 → OEM 회사 탭 집계 함수(`kg-mobility/aggregate.ts`)의 입력 행.
 * 그룹 월 표엔 지역·차종·PT 가 없어 빈 값 → EV 비중은 계산하지 않는다(호출부가 null 로 덮는다).
 */
export function groupMonthToSaleRows(
  rows: OemSalesGroupMonth[],
  group: string
): CompanySaleRowWithPt[] {
  return rows
    .filter((r) => r.oem_group === group)
    .map((r) => {
      const s = String(r.year_month);
      return {
        period_type: 'month' as const,
        year_period: `${s.slice(0, 4)}-${s.slice(4, 6)}`,
        region: '',
        vehicle_model: '',
        vehicle_type: '',
        powertrain: null,
        sales_units: r.sales,
        source_url: null,
        resolved_powertrain: null,
      };
    });
}
