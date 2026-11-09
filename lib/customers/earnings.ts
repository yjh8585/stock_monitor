import type { CustomerEarnings, CustomerEarningsPoint, FinancialPeriodRow } from './types';

const toBn = (v: number | null) => (v == null ? null : v / 1000);
/** 정렬 키 — 연간 행(분기 null)은 5로 쳐서 같은 해 분기들 뒤에 둔다. */
const order = (r: FinancialPeriodRow) => r.fiscal_year * 10 + (r.fiscal_quarter ?? 5);

/** 같은 (구분, 연, 분기) 중 결산일이 늦은 행 하나. */
function dedupe(rows: FinancialPeriodRow[]): FinancialPeriodRow[] {
  const map = new Map<string, FinancialPeriodRow>();
  for (const r of rows) {
    const key = `${r.period_type}|${r.fiscal_year}|${r.fiscal_quarter ?? ''}`;
    const prev = map.get(key);
    if (!prev || (r.period_end_date ?? '') > (prev.period_end_date ?? '')) map.set(key, r);
  }
  return [...map.values()];
}

function toPoints(rows: FinancialPeriodRow[], quarterly: boolean): CustomerEarningsPoint[] {
  const sorted = [...rows].sort((x, y) => order(x) - order(y));
  const byKey = new Map(sorted.map((r) => [`${r.fiscal_year}|${r.fiscal_quarter ?? ''}`, r]));
  return sorted.map((r) => {
    const prev = byKey.get(`${r.fiscal_year - 1}|${r.fiscal_quarter ?? ''}`);
    const yoy =
      r.revenue != null && prev?.revenue != null && prev.revenue > 0
        ? ((r.revenue - prev.revenue) / prev.revenue) * 100
        : null;
    return {
      period_label: quarterly ? `${r.fiscal_year}Q${r.fiscal_quarter}` : String(r.fiscal_year),
      fiscal_year: r.fiscal_year,
      fiscal_quarter: r.fiscal_quarter,
      revenue_bn: toBn(r.revenue),
      operating_income_bn: toBn(r.operating_income),
      operating_margin_pct: r.operating_margin,
      net_income_bn: toBn(r.net_income),
      revenue_yoy_pct: yoy,
    };
  });
}

/**
 * financials → 실적 표·차트 점(현지 통화 십억).
 * 통화가 섞인 회사가 있어(분기 1건만 다른 통화) 매출이 있는 최신 행의 통화만 남긴다.
 * 매출이 전부 비면 영업이익·순이익이 있는 최신 행의 통화로 대신한다(이익 수치까지 「데이터 없음」이 되지 않게).
 */
export function buildEarnings(rows: FinancialPeriodRow[]): CustomerEarnings {
  const withRevenue = rows.filter((r) => r.revenue != null);
  const candidates =
    withRevenue.length > 0
      ? withRevenue
      : rows.filter((r) => r.operating_income != null || r.net_income != null);
  if (candidates.length === 0) return { currency: null, quarterly: [], annual: [] };
  const latest = candidates.reduce((best, r) => (order(r) > order(best) ? r : best));
  const same = dedupe(rows.filter((r) => r.currency === latest.currency));
  return {
    currency: latest.currency,
    quarterly: toPoints(
      same.filter((r) => r.period_type === 'quarterly' && r.fiscal_quarter != null),
      true
    ),
    annual: toPoints(
      same.filter((r) => r.period_type === 'annual'),
      false
    ),
  };
}
