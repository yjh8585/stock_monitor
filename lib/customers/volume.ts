import { MIN_YOY_PREV_SALES } from '@/lib/oem-companies/kg-mobility/aggregate';
import type { CompanySaleRowWithPt, CompanyTimeSeriesPoint, OemSalesGroupMonth } from '@/lib/types';

/**
 * MarkLines 월 판매 점 → 분기 점(물량 차트 「분기」 보기 · A9). 석 달이 다 있는 분기만 — 진행 중인 분기를
 * 두 달 합으로 그리면 회사 발표 분기와 견줄 때 「급감」으로 보인다. period = 'YYYY-Qn'(회사 발표 분기와 같은 꼴).
 * YoY 는 월 점과 같은 문턱(MIN_YOY_PREV_SALES).
 */
export function monthlyToQuarterly(monthly: CompanyTimeSeriesPoint[]): CompanyTimeSeriesPoint[] {
  const sums = new Map<string, { sales: number; months: number }>();
  for (const p of monthly) {
    const m = /^(\d{4})-(\d{2})$/.exec(p.period);
    if (!m) continue;
    const key = `${m[1]}-Q${Math.ceil(Number(m[2]) / 3)}`;
    const cur = sums.get(key) ?? { sales: 0, months: 0 };
    sums.set(key, { sales: cur.sales + p.sales, months: cur.months + 1 });
  }
  const full = [...sums].filter(([, v]) => v.months === 3).sort(([a], [b]) => a.localeCompare(b));
  const byKey = new Map(full);
  return full.map(([period, v]) => {
    const prev = byKey.get(`${Number(period.slice(0, 4)) - 1}${period.slice(4)}`)?.sales;
    return {
      period,
      period_label: period.replace('-', ''),
      sales: v.sales,
      yoy_pct: prev == null || prev < MIN_YOY_PREV_SALES ? null : ((v.sales - prev) / prev) * 100,
    };
  });
}

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
