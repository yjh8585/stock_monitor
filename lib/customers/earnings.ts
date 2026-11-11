import type {
  CellOrigin,
  CustomerEarnings,
  CustomerEarningsPoint,
  EarningsOrigin,
  FinancialPeriodRow,
} from './types';

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

/** 실적 표 분기 한 줄 — 점 + 직전 분기 대비·연초부터 누적(2026-11-11 사용자 지시 A8). */
export interface QuarterRowView extends CustomerEarningsPoint {
  /** 직전 분기(같은 해 앞 분기 · 1분기면 전년 4분기) 대비 매출 증감(%). */
  revenue_qoq_pct: number | null;
  /** 그해 1분기~이 분기 매출 합. 앞 분기 중 하나라도 비면 null(빠진 분기를 0 으로 치지 않는다). */
  ytd_revenue_bn: number | null;
  ytd_operating_income_bn: number | null;
}

const qKeyOf = (y: number, q: number) => `${y}|${q}`;
const growthPct = (cur: number | null, prev: number | null | undefined) =>
  cur != null && prev != null && prev > 0 ? ((cur - prev) / prev) * 100 : null;

function quarterIndex(quarterly: CustomerEarningsPoint[]): Map<string, CustomerEarningsPoint> {
  const m = new Map<string, CustomerEarningsPoint>();
  for (const p of quarterly)
    if (p.fiscal_quarter != null) m.set(qKeyOf(p.fiscal_year, p.fiscal_quarter), p);
  return m;
}

/** 1분기~q분기 값의 합 — 하나라도 없으면 null. */
function sumThrough(
  byKey: Map<string, CustomerEarningsPoint>,
  year: number,
  q: number,
  pick: (p: CustomerEarningsPoint) => number | null
): number | null {
  let s = 0;
  for (let i = 1; i <= q; i++) {
    const v = byKey.get(qKeyOf(year, i));
    const x = v ? pick(v) : null;
    if (x == null) return null;
    s += x;
  }
  return s;
}

/**
 * 1분기~q분기 영업이익의 합 — 분기마다 출처(장부상·회사 조정·시장)가 다르면 정의가 다른 값을 더하게 되므로 null.
 * 출처 표시가 없는 점(국내 · financials 그대로)은 한 정의로 본다.
 */
function sumOperatingIncome(
  byKey: Map<string, CustomerEarningsPoint>,
  year: number,
  q: number
): number | null {
  const sources = new Set<string>();
  for (let i = 1; i <= q; i++) {
    const s = byKey.get(qKeyOf(year, i))?.origin?.operating_income.source;
    if (s) sources.add(s);
  }
  return sources.size > 1 ? null : sumThrough(byKey, year, q, (x) => x.operating_income_bn);
}

/** 분기 점 → 표 한 줄(QoQ·누적). 순서는 받은 그대로. */
export function quarterRows(quarterly: CustomerEarningsPoint[]): QuarterRowView[] {
  const byKey = quarterIndex(quarterly);
  return quarterly.map((p) => {
    const q = p.fiscal_quarter;
    if (q == null)
      return { ...p, revenue_qoq_pct: null, ytd_revenue_bn: null, ytd_operating_income_bn: null };
    const prev =
      q === 1 ? byKey.get(qKeyOf(p.fiscal_year - 1, 4)) : byKey.get(qKeyOf(p.fiscal_year, q - 1));
    return {
      ...p,
      revenue_qoq_pct: growthPct(p.revenue_bn, prev?.revenue_bn),
      ytd_revenue_bn: sumThrough(byKey, p.fiscal_year, q, (x) => x.revenue_bn),
      ytd_operating_income_bn: sumOperatingIncome(byKey, p.fiscal_year, q),
    };
  });
}

/**
 * 연간 보기의 「<해> YTD」 행 — 분기 자료의 가장 늦은 해가 연간 목록에 아직 없을 때만(연도는 데이터에서 · 시계 아님).
 * 그해 1분기~마지막 분기가 다 있어야 만든다. YoY 는 전년 같은 분기들의 합과 견준다. 순이익도 분기가 다 있을 때만.
 */
export function ytdAnnualPoint(
  quarterly: CustomerEarningsPoint[],
  annual: CustomerEarningsPoint[]
): CustomerEarningsPoint | null {
  const withRev = quarterly.filter((p) => p.fiscal_quarter != null && p.revenue_bn != null);
  if (withRev.length === 0) return null;
  const year = Math.max(...withRev.map((p) => p.fiscal_year));
  if (annual.some((p) => p.fiscal_year === year)) return null;
  const lastQ = Math.max(
    ...withRev.filter((p) => p.fiscal_year === year).map((p) => p.fiscal_quarter ?? 0)
  );
  const byKey = quarterIndex(quarterly);
  const revenue = sumThrough(byKey, year, lastQ, (x) => x.revenue_bn);
  if (revenue == null) return null;
  const oi = sumOperatingIncome(byKey, year, lastQ);
  // 합친 분기들의 출처(해외만) — 한 해 안에서 같으면 그것을 실어 표가 YTD 행에도 「조정」을 밝힌다.
  // 섞였으면 영업이익은 이미 null 이라 그 칸 출처는 'none'.
  const qs = Array.from({ length: lastQ }, (_, i) => byKey.get(qKeyOf(year, i + 1))!);
  const common = (f: keyof EarningsOrigin): CellOrigin => {
    const first = qs[0].origin![f];
    return qs.every((x) => x.origin![f].source === first.source)
      ? { source: first.source, ...(first.metric_name ? { metric_name: first.metric_name } : {}) }
      : { source: 'none' };
  };
  const origin: EarningsOrigin | undefined = qs.every((x) => x.origin)
    ? {
        revenue: common('revenue'),
        operating_income: common('operating_income'),
        net_income: common('net_income'),
      }
    : undefined;
  return {
    period_label: `${year} YTD(${lastQ === 1 ? '1분기' : `1~${lastQ}분기`})`,
    ...(origin ? { origin } : {}),
    fiscal_year: year,
    fiscal_quarter: null,
    revenue_bn: revenue,
    operating_income_bn: oi,
    operating_margin_pct: oi != null && revenue > 0 ? (oi / revenue) * 100 : null,
    net_income_bn: sumThrough(byKey, year, lastQ, (x) => x.net_income_bn),
    revenue_yoy_pct: growthPct(
      revenue,
      sumThrough(byKey, year - 1, lastQ, (x) => x.revenue_bn)
    ),
  };
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
