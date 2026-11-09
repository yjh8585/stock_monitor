/**
 * 고객사 공식 문서(공시·IR) 숫자의 순수 접기 함수 — source.ts(getCustomerIr)와 화면이 함께 쓴다.
 * 지시어 없는 파일이라 서버 컴포넌트가 값으로 import 해도 된다. 날짜(today)는 인자로만 받는다.
 */
import type { CellOrigin, CumulativeNote, CustomerEarnings, CustomerEarningsPoint } from './types';

// ---------------------------------------------------------------- 누계 → 분기
export interface IrSeriesRow {
  period_grain: 'quarter' | 'ytd' | 'year';
  period: string; // 2026-Q3 · 2026-6M · 2026
  value: number;
}
export interface QuarterPoint {
  period: string; // 2026-Q3
  value: number;
  /** 누계끼리 빼서 만든 값(회사가 분기 값을 따로 내지 않았다). */
  derived: boolean;
}

/**
 * 분기 행은 그대로, 누계(ytd·year)는 이웃 누계를 빼 분기를 만든다(derived=true).
 * Q1 = 분기 행 또는 3M · Q2 = 6M − Q1 · Q3 = 9M − 6M · Q4 = 연간 − 9M. 재료가 하나라도 없으면 만들지 않는다(추정 금지).
 * 단위는 호출부가 미리 맞춰 넘긴다(포르쉐는 1분기 million · 반기 billion).
 */
export function quarterize(rows: IrSeriesRow[]): QuarterPoint[] {
  const direct = new Map<string, number>();
  const cum = new Map<string, number>(); // `${y}|${n}` → n 분기까지 누계
  for (const r of rows) {
    if (r.period_grain === 'quarter') direct.set(r.period, r.value);
    else if (r.period_grain === 'year') cum.set(`${r.period}|4`, r.value);
    else {
      const m = /^(\d{4})-(3|6|9)M$/.exec(r.period);
      if (m) cum.set(`${m[1]}|${Number(m[2]) / 3}`, r.value);
    }
  }
  const years = new Set<string>();
  for (const k of direct.keys()) years.add(k.slice(0, 4));
  for (const k of cum.keys()) years.add(k.slice(0, 4));
  const out: QuarterPoint[] = [];
  for (const y of [...years].sort()) {
    // Q1 은 분기 행이 곧 누계
    const c = (n: number) =>
      n === 1 ? (direct.get(`${y}-Q1`) ?? cum.get(`${y}|1`)) : cum.get(`${y}|${n}`);
    for (let q = 1; q <= 4; q++) {
      const period = `${y}-Q${q}`;
      const d = direct.get(period);
      const q1Cum = cum.get(`${y}|1`);
      if (d != null) out.push({ period, value: d, derived: false });
      else if (q === 1 && q1Cum != null) out.push({ period, value: q1Cum, derived: false });
      else if (q > 1) {
        const hi = c(q);
        const lo = c(q - 1);
        if (hi != null && lo != null) out.push({ period, value: hi - lo, derived: true });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- 가이던스
/** 상태만 나타내는 행(철회·「가이던스 확인」) — low·high 가 없고 value_text 에 원문 낱말. 숫자 지표가 아니다. */
export const STATUS_METRIC = 'other';

export interface GuidanceRowTs {
  metric: string;
  metric_label: string;
  period: string; // FY2026
  low: number | null;
  high: number | null;
  value_text: string | null;
  unit: string;
  basis: 'reported' | 'adjusted' | null;
  /** null = 회사 보고 통화. 값이 있으면 그 통화(모비스 외화 수주 목표 등). */
  currency: string | null;
  stated: string | null;
  direction: string | null;
  extractor: 'code' | 'llm';
  quote: string;
  published_at: string;
  verified: boolean;
}
/** 한 FY 의 전망 — 최신 행 + 이력. */
export interface GuidanceTarget {
  period: string; // FY2026
  current: GuidanceRowTs;
  /** 같은 (metric, 통화, FY) 의 이력 — 오래된 것부터, current 포함. */
  history: GuidanceRowTs[];
  /** 같은 FY 의 철회 상태 행이 current 이후(같은 날 포함)에 있으면 그 날짜 — 화면은 「철회됨」. */
  withdrawn_at: string | null;
}
export interface GuidanceCard extends GuidanceTarget {
  metric: string;
  /** 이 카드 금액의 통화(행의 currency, 없으면 회사 보고 통화). 통화가 다르면 카드를 나눈다. */
  currency: string | null;
  /** 대표 FY 보다 먼 FY(중장기 목표 FY2030 등) — FY 오름차순. 화면이 따로 보여 준다. */
  longer_term: GuidanceTarget[];
}

const isStatus = (r: GuidanceRowTs) => r.metric === STATUS_METRIC;

/** period(FY) 전망이 since 이후 철회됐으면 가장 이른 철회 날짜. 철회 뒤 새로 낸 전망(since 가 더 늦다)은 철회가 아니다. */
function withdrawnAt(rows: GuidanceRowTs[], period: string, since: string): string | null {
  const hits = rows
    .filter(
      (r) =>
        r.verified &&
        isStatus(r) &&
        r.stated === 'withdrawn' &&
        r.period === period &&
        r.published_at >= since
    )
    .map((r) => r.published_at)
    .sort();
  return hits[0] ?? null;
}

const fyNum = (period: string) => Number(period.slice(2));

const extractorRank = (r: GuidanceRowTs) => (r.extractor === 'code' ? 1 : 0);

/**
 * 한 FY 의 이력 — 같은 날 같은 값(DART 공시 code + IR 자료 llm 처럼 같은 전망을 두 문서가 낸 것)은 한 줄로 접고
 * 코드 추출을 남긴다(코드 우선). 값이 다르면 둘 다 두되 같은 날이면 코드 행을 뒤(= current)로. 그 밖은 입력 순서.
 */
function foldHistory(rows: GuidanceRowTs[]): GuidanceRowTs[] {
  const byKey = new Map<string, GuidanceRowTs>();
  for (const r of rows) {
    const k = JSON.stringify([r.published_at, r.low, r.high, r.value_text, r.unit, r.currency]);
    const kept = byKey.get(k);
    if (!kept || extractorRank(r) > extractorRank(kept)) byKey.set(k, r);
  }
  return [...byKey.values()].sort(
    (a, b) => a.published_at.localeCompare(b.published_at) || extractorRank(a) - extractorRank(b)
  );
}

/**
 * 검증된 행만 · (metric, 통화) 별 카드 하나. 대표 FY = `year`(서울 달력 연도 — 호출부가 currentYear() 로 넘긴다)
 * 이상인 FY 중 가장 가까운 것, 없으면 가장 늦은 FY(작년 전망만 남은 경우). 대표 FY 보다 먼 FY 는 longer_term 으로 —
 * 중장기 목표(FY2030)가 올해 전망을 가리지 않게. 대표 FY 보다 이른 FY 는 싣지 않는다.
 * 상태 행(metric=other)은 카드가 되지 않고 철회 판정 재료로만 쓴다(→ guidanceStatusNotes).
 */
export function latestGuidance(
  rows: GuidanceRowTs[],
  year: number,
  baseCurrency: string | null = null
): GuidanceCard[] {
  const ok = rows.filter((r) => r.verified);
  const groups = new Map<string, GuidanceRowTs[]>();
  for (const r of ok) {
    if (isStatus(r)) continue;
    const k = `${r.metric}|${r.currency ?? baseCurrency ?? ''}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const target = (list: GuidanceRowTs[], period: string): GuidanceTarget => {
    const history = foldHistory(list.filter((r) => r.period === period));
    const current = history.at(-1)!;
    return {
      period,
      current,
      history,
      withdrawn_at: withdrawnAt(ok, period, current.published_at),
    };
  };
  const cards: GuidanceCard[] = [];
  for (const list of groups.values()) {
    const fys = [...new Set(list.map((r) => r.period))].sort((a, b) => fyNum(a) - fyNum(b));
    const fy = fys.find((p) => fyNum(p) >= year) ?? fys.at(-1)!;
    const main = target(list, fy);
    cards.push({
      ...main,
      metric: main.current.metric,
      currency: main.current.currency ?? baseCurrency,
      longer_term: fys.filter((p) => fyNum(p) > fyNum(fy)).map((p) => target(list, p)),
    });
  }
  return cards;
}

/** 검증된 상태 행(철회·유지 확인) — 날짜순. 화면의 「FY2025 전망 철회」 같은 한 줄 재료. */
export function guidanceStatusNotes(rows: GuidanceRowTs[]): GuidanceRowTs[] {
  return rows
    .filter((r) => r.verified && isStatus(r))
    .sort((a, b) => a.published_at.localeCompare(b.published_at));
}

export interface GuidanceChange {
  metric_label: string;
  direction: 'raised' | 'lowered';
  period: string;
  published_at: string;
  /** 그 FY 가 이후 철회됐으면 날짜(요약 표에서 상향·하향 대신 「철회됨」). */
  withdrawn_at: string | null;
}

/**
 * 요약 표 「최근 가이던스 변경」 — 카드와 같은 기준(latestGuidance 의 대표 FY)의 이력 중 가장 최근 상향·하향 1건.
 * 먼 목표(longer_term)만 바뀌었으면 null(= 「변경 없음」) — 먼 목표의 변경은 개별 페이지에서만 보인다.
 */
export function latestGuidanceChange(
  rows: GuidanceRowTs[],
  year: number,
  baseCurrency: string | null = null
): GuidanceChange | null {
  const ok = rows.filter((r) => r.verified);
  const last = latestGuidance(ok, year, baseCurrency)
    .flatMap((c) => c.history)
    .filter((r) => r.direction === 'raised' || r.direction === 'lowered')
    .sort((a, b) => a.published_at.localeCompare(b.published_at))
    .at(-1);
  if (!last) return null;
  return {
    metric_label: last.metric_label,
    direction: last.direction as GuidanceChange['direction'],
    period: last.period,
    published_at: last.published_at,
    withdrawn_at: withdrawnAt(ok, last.period, last.published_at),
  };
}

// ---------------------------------------------------------------- 다음 실적 일정
export interface EarningsDateRow {
  period: string; // 2026-Q3 · 2026-FY
  event_date: string;
  source?: string;
  url?: string | null;
}
export interface NextEarnings {
  period: string;
  date: string;
  estimated: boolean;
  /** 확정 일정의 출처(estimated=false 일 때만). */
  source?: string;
  url?: string;
}
const qKey = (p: string) => p.replace(/-FY$/, '-Q4');

/**
 * today(서울 날짜 YYYY-MM-DD) 이후 가장 이른 일정 = 확정. 없으면 마지막 발표의 다음 분기를
 * «작년 같은 분기 발표일 + 1년»으로 추정한다. 재료가 없거나 추정일이 이미 지났으면(수집 밀림) null.
 */
export function nextEarnings(rows: EarningsDateRow[], today: string): NextEarnings | null {
  const future = rows
    .filter((r) => r.event_date >= today)
    .sort((a, b) => a.event_date.localeCompare(b.event_date));
  if (future.length > 0) {
    const r = future[0];
    return {
      period: r.period,
      date: r.event_date,
      estimated: false,
      ...(r.source ? { source: r.source } : {}),
      ...(r.url ? { url: r.url } : {}),
    };
  }
  const last = [...rows].sort((a, b) => qKey(a.period).localeCompare(qKey(b.period))).at(-1);
  const m = last && /^(\d{4})-Q([1-4])$/.exec(qKey(last.period));
  if (!m) return null;
  const [y, q] = [Number(m[1]), Number(m[2])];
  const next = q === 4 ? { y: y + 1, q: 1 } : { y, q: q + 1 };
  const prev = rows.find((r) => qKey(r.period) === `${next.y - 1}-Q${next.q}`);
  if (!prev) return null;
  const md = prev.event_date.slice(4) === '-02-29' ? '-02-28' : prev.event_date.slice(4);
  const date = `${Number(prev.event_date.slice(0, 4)) + 1}${md}`;
  if (date < today) return null;
  return { period: `${next.y}-Q${next.q}`, date, estimated: true };
}

// ---------------------------------------------------------------- 회사 발표 물량
export interface VolumeRow {
  metric: string;
  region: string;
  period_grain: 'month' | 'quarter' | 'ytd' | 'year';
  period: string; // 2026-10 · 2026-Q3 · 2026-9M · 2026
  value: number;
  definition: string;
  published_at: string;
}
export interface VolumeSeries {
  metric: string;
  region: string;
  /** 가장 최근 공시의 정의 문구(「정의 차이」 상자). */
  definition: string;
  monthly: { period: string; value: number }[];
  /** 분기 행 + 누계 차이로 만든 분기(derived=true → 화면 「계산값」). */
  quarterly: QuarterPoint[];
  annual: { period: string; value: number }[];
}

/** (metric, region) 별 계열 — region 'total' 이 먼저, 나머지는 이름순. */
export function buildVolumeSeries(rows: VolumeRow[]): VolumeSeries[] {
  const groups = new Map<string, VolumeRow[]>();
  for (const r of rows) {
    const k = `${r.metric}|${r.region}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const rank = (s: VolumeSeries) => `${s.metric}|${s.region === 'total' ? '' : s.region}`;
  const byPeriod = (a: { period: string }, b: { period: string }) =>
    a.period.localeCompare(b.period);
  return [...groups.values()]
    .map((list) => {
      const latest = list.reduce((a, b) => (b.published_at > a.published_at ? b : a));
      const pick = (grain: VolumeRow['period_grain']) =>
        list
          .filter((r) => r.period_grain === grain)
          .map((r) => ({ period: r.period, value: r.value }))
          .sort(byPeriod);
      return {
        metric: latest.metric,
        region: latest.region,
        definition: latest.definition,
        monthly: pick('month'),
        quarterly: quarterize(
          list.flatMap((r) =>
            r.period_grain === 'month'
              ? []
              : [{ period_grain: r.period_grain, period: r.period, value: r.value }]
          )
        ),
        annual: pick('year'),
      };
    })
    .sort((a, b) => rank(a).localeCompare(rank(b)));
}

// ---------------------------------------------------------------- 실적 칸 출처 고르기(선택 7차)
export interface ReportedRow {
  period_grain: 'quarter' | 'ytd' | 'year';
  period: string;
  metric: string;
  metric_name: string;
  basis: 'reported' | 'adjusted';
  value: number;
  unit: 'million' | 'billion' | 'per_share';
  currency: string;
}
/** 장부상 영업이익이 없을 때 대신 쓰는 회사 조정 영업이익 — 앞의 것이 먼저. EBITDA 는 영업이익이 아니라 넣지 않는다. */
export const ADJUSTED_OPERATING_METRICS = ['ebit_adjusted', 'aoi', 'operating_result_bsi'] as const;

/**
 * 별도(개별) 재무제표 기준 행. 충돌 키에 basis 가 없어 수집기가 metric_name 에 「(별도)」를 붙여 둔다(KGM).
 * 실적 칸은 연결 기준이라 이 행은 칸 값·누계 차이·각주 어디에도 쓰지 않는다.
 */
export const isSeparateBasis = (metricName: string) => /\(\s*별도\s*\)/.test(metricName);

/** 십억 단위로 — 단위 환산은 누계 빼기보다 «먼저»(포르쉐 1분기 million · 반기 billion). */
const bn = (r: { value: number; unit: string }) =>
  r.unit === 'million' ? r.value / 1000 : r.value;

type Pick = { value_bn: number; derived: boolean; metric_name: string };

/** metric 하나의 회사 값: 분기 = 직접 행 우선 · 없으면 누계 차이 / 연간 = year 행. */
function companySeries(rows: ReportedRow[], metric: string, quarterly: boolean): Map<string, Pick> {
  const mine = rows.filter((r) => r.metric === metric);
  const out = new Map<string, Pick>();
  if (mine.length === 0) return out;
  const name = mine.find((r) => r.period_grain === 'quarter')?.metric_name ?? mine[0].metric_name;
  if (quarterly) {
    for (const p of quarterize(
      mine.map((r) => ({ period_grain: r.period_grain, period: r.period, value: bn(r) }))
    ))
      out.set(p.period, { value_bn: p.value, derived: p.derived, metric_name: name });
  } else {
    for (const r of mine.filter((x) => x.period_grain === 'year'))
      out.set(r.period, { value_bn: bn(r), derived: false, metric_name: r.metric_name });
  }
  return out;
}

function cumulativeNotes(
  rows: ReportedRow[],
  year: number,
  metrics: readonly string[]
): CumulativeNote[] {
  return rows
    .filter(
      (r) =>
        metrics.includes(r.metric) &&
        r.period_grain !== 'quarter' &&
        r.period.startsWith(String(year))
    )
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((r) => ({
      period: r.period,
      metric_name: r.metric_name,
      basis: r.basis,
      value_bn: bn(r),
    }));
}

/**
 * 해외 회사 실적 점의 매출·영업이익·순이익을 출처 순서대로 고르고, 칸마다 출처를 `origin` 에 내려 준다.
 * - 매출: 회사 장부상 → 시장 데이터 → 없음
 * - 순이익: 회사 세후 합계(net_income) → 회사 지배주주 귀속(net_income_parent) → 시장 데이터 → 없음
 *   정의가 출처마다 달라 origin.definition 을 붙인다(회사 net_income 'total' · 회사 parent·시장 'parent')
 * - 영업이익: 회사 장부상 → 회사 조정 영업이익(ADJUSTED_OPERATING_METRICS 순) → 시장 데이터 → 없음
 * - 영업이익률 = 고른 영업이익 ÷ 고른 매출(둘 중 하나라도 없으면 null)
 * - 회사 값만 있고 financials 점이 없는 분기도 점을 만든다
 * 출처는 «읽을 때» 고른다 — DB 의 yfinance 행은 그대로 두고, 회사 값이 나중에 적재되면 다음 렌더부터 그 칸이 회사 값으로 바뀐다.
 * 통화가 다른 회사 행(financials 통화 ≠ 공시 통화)·주당 값(per_share)·별도 기준 행은 쓰지 않는다
 * (통화 때문에 버린 행은 droppedCurrencies 로 알 수 있다 — 서버 래퍼 pickCustomerEarnings 가 로그를 남긴다).
 */
export function pickEarnings(
  earnings: CustomerEarnings,
  reported: ReportedRow[]
): CustomerEarnings {
  const usable = usableReported(reported);
  const currency = earningsCurrencyOf(earnings, usable);
  const rows = usable.filter((r) => r.currency === currency);
  const reportedRows = rows.filter((r) => r.basis === 'reported');
  return {
    currency,
    quarterly: pickPoints(earnings.quarterly, rows, reportedRows, true),
    annual: pickPoints(earnings.annual, rows, reportedRows, false),
  };
}

const usableReported = (reported: ReportedRow[]) =>
  reported.filter((r) => r.unit !== 'per_share' && !isSeparateBasis(r.metric_name));
const earningsCurrencyOf = (earnings: CustomerEarnings, usable: ReportedRow[]) =>
  earnings.currency ?? usable[0]?.currency ?? null;

/** pickEarnings 가 실적 통화와 달라 버리는 회사 행의 통화(중복 없이). 없으면 빈 배열. */
export function droppedCurrencies(earnings: CustomerEarnings, reported: ReportedRow[]): string[] {
  const usable = usableReported(reported);
  const currency = earningsCurrencyOf(earnings, usable);
  return [...new Set(usable.filter((r) => r.currency !== currency).map((r) => r.currency))];
}

function pickPoints(
  points: CustomerEarningsPoint[],
  rows: ReportedRow[],
  reportedRows: ReportedRow[],
  quarterly: boolean
): CustomerEarningsPoint[] {
  const key = (y: number, q: number | null) => (quarterly ? `${y}-Q${q}` : String(y));
  const rev = companySeries(reportedRows, 'revenue', quarterly);
  const op = companySeries(reportedRows, 'operating_income', quarterly);
  const net = companySeries(reportedRows, 'net_income', quarterly);
  const netParent = companySeries(reportedRows, 'net_income_parent', quarterly);
  const adjustedRows = rows.filter((r) => r.basis === 'adjusted');
  const adj = ADJUSTED_OPERATING_METRICS.map((m) => companySeries(adjustedRows, m, quarterly));

  // financials 점 + 회사 값만 있는 기간
  const base = new Map(points.map((p) => [key(p.fiscal_year, p.fiscal_quarter), p]));
  for (const k of [
    ...rev.keys(),
    ...op.keys(),
    ...net.keys(),
    ...netParent.keys(),
    ...adj.flatMap((a) => [...a.keys()]),
  ]) {
    if (base.has(k)) continue;
    const m = /^(\d{4})(?:-Q([1-4]))?$/.exec(k);
    if (!m) continue;
    const [y, q] = [Number(m[1]), m[2] ? Number(m[2]) : null];
    base.set(k, {
      period_label: quarterly ? `${y}Q${q}` : String(y),
      fiscal_year: y,
      fiscal_quarter: q,
      revenue_bn: null,
      operating_income_bn: null,
      operating_margin_pct: null,
      net_income_bn: null,
      revenue_yoy_pct: null,
    });
  }

  const opMetrics = ['operating_income', ...ADJUSTED_OPERATING_METRICS];
  const chosen = new Map<string, CustomerEarningsPoint>();
  for (const [k, p] of base) {
    const cell = (
      company: Pick | undefined,
      market: number | null,
      metrics: readonly string[]
    ): { v: number | null; o: CellOrigin } => {
      if (company) {
        const o: CellOrigin = { source: 'company_reported' };
        if (company.derived) o.derived = true;
        return { v: company.value_bn, o };
      }
      if (market != null) {
        const notes = cumulativeNotes(rows, p.fiscal_year, metrics);
        const o: CellOrigin = { source: 'market' };
        if (notes.length > 0) o.company_cumulative = notes;
        return { v: market, o };
      }
      return { v: null, o: { source: 'none' } };
    };
    const r = cell(rev.get(k), p.revenue_bn, ['revenue']);
    const netTotal = net.get(k);
    const n = cell(netTotal ?? netParent.get(k), p.net_income_bn, [
      'net_income',
      'net_income_parent',
    ]);
    if (n.o.source === 'company_reported') n.o.definition = netTotal ? 'total' : 'parent';
    else if (n.o.source === 'market') n.o.definition = 'parent';
    let o = cell(op.get(k), p.operating_income_bn, opMetrics);
    if (!op.get(k)) {
      const a = adj.map((s) => s.get(k)).find((x) => x != null);
      if (a) {
        const origin: CellOrigin = { source: 'company_adjusted', metric_name: a.metric_name };
        if (a.derived) origin.derived = true;
        o = { v: a.value_bn, o: origin };
      }
    }
    const margin = o.v != null && r.v != null && r.v !== 0 ? (o.v / r.v) * 100 : null;
    const adjusted = ADJUSTED_OPERATING_METRICS.flatMap((m, i) => {
      const a = adj[i].get(k);
      return a && !a.derived
        ? [{ metric: m as string, name: a.metric_name, value_bn: a.value_bn }]
        : [];
    });
    chosen.set(k, {
      ...p,
      revenue_bn: r.v,
      operating_income_bn: o.v,
      operating_margin_pct: margin,
      net_income_bn: n.v,
      origin: { revenue: r.o, operating_income: o.o, net_income: n.o },
      ...(adjusted.length > 0 ? { adjusted } : {}),
    });
  }

  // 매출 출처가 회사로 바뀐 점만 전년 대비를 다시 잰다(시장 값 그대로인 점은 1단계 값 유지)
  const out = [...chosen.values()].sort(
    (a, b) =>
      a.fiscal_year * 10 + (a.fiscal_quarter ?? 5) - (b.fiscal_year * 10 + (b.fiscal_quarter ?? 5))
  );
  for (const p of out) {
    if (p.origin?.revenue.source !== 'company_reported') continue;
    const prev = chosen.get(key(p.fiscal_year - 1, p.fiscal_quarter));
    p.revenue_yoy_pct =
      p.revenue_bn != null && prev?.revenue_bn != null && prev.revenue_bn > 0
        ? ((p.revenue_bn - prev.revenue_bn) / prev.revenue_bn) * 100
        : p.revenue_yoy_pct;
  }
  return out;
}
