/**
 * 고객사 「지역·차종·점유율」 절 재료 — customer_breakdown_ir(verified 만)를 탭 3개로 묶는다(결정 C3·C4·C7).
 * 계획 = docs/plans/2026-11-11-customers-page-revisions.md 「Task C-6」.
 *
 * - 대수·매출(가산되는 값) → 누적 막대(HyundaiQuarterlyRegionsChart 재사용) · 구성비·점유율(%) → 표.
 * - 묶음 = (kind, metric, unit). 차트는 기간 꼴 하나만 고른다(pickGrain) · 표는 그 꼴 + 연간.
 * - 🔴 차트는 «한 기간 = 한 문서»: 같은 분기를 팩트시트와 발표자료가 서로 다른 이름 체계로 싣는다(포르쉐 「Macan ICE」 ↔
 *   「Macan (Combustion Engine)」). 문서를 섞어 쌓으면 같은 차가 두 번 쌓인다 → 그 기간에 구분이 가장 많은 문서(같으면 최신)만 쓴다.
 * - 표는 칸(라벨 × 기간)마다 가장 최근 공시 값 — 쌓지 않으니 문서가 섞여도 두 번 세지 않는다.
 * - 계열 이름 = label_ko(문서마다 원문 표기가 갈려도 한국어 이름이 같으면 한 계열 — 「Europe」·「Europe (excl. GER)」).
 */
import type { HyundaiQuarterlyRegionPoint } from '@/lib/types';

export type BreakdownKind = 'region' | 'model' | 'share';
export type BreakdownGrain = 'month' | 'quarter' | 'half' | 'ytd' | 'year' | 'asof';
export type BreakdownUnit = 'units' | 'pct' | 'share_pct' | 'KRW' | 'USD' | 'EUR' | 'VND';

/** 조회 계층이 넘기는 한 행(verified 만 · 문서 제목·URL 은 customer_documents 외래키로). */
export interface BreakdownRow {
  document_id: number;
  page: number | null;
  kind: BreakdownKind;
  metric: string;
  label_raw: string;
  label_ko: string;
  period_grain: BreakdownGrain;
  period: string;
  value: number;
  unit: BreakdownUnit;
  definition: string | null;
  published_at: string;
  doc_title: string | null;
  doc_url: string | null;
}

/** 차트 보기 하나 — 분기 · 연간(연도 + 올해 누계) · 그 밖의 꼴(월·반기 등). 둘 이상이면 카드에 전환 버튼. */
export interface BreakdownChartView {
  key: string;
  label: string;
  data: HyundaiQuarterlyRegionPoint[];
  /** 올해 누계 막대가 무엇으로 만들어졌나(회사 발표 누계 · 상반기 · 분기 합) — 카드 아래 한 줄. */
  note: string | null;
}

export interface BreakdownChart {
  key: string;
  title: string;
  /** HyundaiQuarterlyRegionsChart 의 unit 인자 그대로. */
  unit: { label: string; tick: 'thousand_units' | 'plain' };
  views: BreakdownChartView[];
}

export interface BreakdownTable {
  key: string;
  title: string;
  unitLabel: string;
  /** prevLabel = 호버 YoY 의 비교 기간(전년 동기) 이름. */
  columns: { period: string; label: string; prevLabel: string | null }[];
  /** yoy = 전년 동기 대비 차이(%p) — 칸 호버에 보인다. 전년 값이 없으면 null. */
  rows: { label: string; values: (number | null)[]; yoy: (number | null)[] }[];
}

/** 뜻 상자 한 줄 — 한국어 이름 · 문서 원문 표기들 · 정의(문서에 있으면). */
export interface BreakdownTerm {
  label: string;
  raw: string[];
  definition: string | null;
}

export interface BreakdownSource {
  docId: number;
  title: string;
  url: string | null;
  publishedAt: string;
  pages: number[];
}

export interface BreakdownTab {
  kind: BreakdownKind;
  title: string;
  charts: BreakdownChart[];
  tables: BreakdownTable[];
  terms: BreakdownTerm[];
  sources: BreakdownSource[];
}

export const KIND_TITLE: Record<BreakdownKind, string> = {
  region: '지역',
  model: '차종·브랜드·부문',
  share: '점유율',
};

const GRAIN_LABEL: Record<BreakdownGrain, string> = {
  quarter: '분기',
  half: '반기',
  ytd: '누계',
  year: '연간',
  month: '월',
  asof: '시점',
};

/** 원문 성격(metric) → 한국어. 없는 이름은 밑줄을 띄어 그대로 보인다(새 metric 이 조용히 사라지지 않게). */
const METRIC_LABEL: Record<string, string> = {
  deliveries: '인도',
  deliveries_mix: '인도 구성비',
  vehicle_sales: '판매',
  vehicle_sales_mix: '판매 구성비',
  deliveries_brand_group_core: '인도(코어 브랜드그룹)',
  deliveries_by_brand: '브랜드그룹별 인도', // 폭스바겐 인도 보도자료 — 차종 인도(deliveries)와 섞이지 않게 따로

  fleet_sales: '플릿(법인) 판매',
  shipments: '출하(연결)',
  combined_shipments: '출하(합작사 포함)',
  wholesale: '도매',
  retail: '소매',
  revenue: '매출',
  sales_mix: '매출 구성비',
  orders: '수주',
  order_intake: '수주',
  order_book: '수주잔고',
  market_share: '시장 점유율',
};

function metricLabel(metric: string, unit: BreakdownUnit): string {
  // 상위 합계와 같은 문서에 실린 하위 구분(북미 ↔ 미국 · 브랜드그룹 ↔ 산하 브랜드)은 적재 때 `<metric>_detail` 로 가른다
  // — 한 차트에 쌓으면 이중 집계가 된다(GM 2026-11-12 실측).
  if (metric.endsWith('_detail'))
    return `${metricLabel(metric.slice(0, -'_detail'.length), unit)}(세분)`;
  // sales 는 회사마다 대수(판매)와 금액(매출)이 갈린다 — 단위로 가른다.
  if (metric === 'sales') return unit === 'units' ? '판매' : '매출';
  return METRIC_LABEL[metric] ?? metric.replaceAll('_', ' ');
}

const CHART_UNITS: Record<
  string,
  { div: number; digits: number; label: string; tick: 'thousand_units' | 'plain' }
> = {
  units: { div: 1_000, digits: 1, label: '천대', tick: 'thousand_units' },
  KRW: { div: 1e8, digits: 0, label: '억원', tick: 'plain' },
  USD: { div: 1e6, digits: 0, label: '백만 USD', tick: 'plain' },
  EUR: { div: 1e6, digits: 0, label: '백만 EUR', tick: 'plain' },
  VND: { div: 1e9, digits: 0, label: '십억 VND', tick: 'plain' },
};

const isPercent = (u: BreakdownUnit) => u === 'pct' || u === 'share_pct';

/** 기간 정렬 열쇠 — 「2026-9M」 과 「2026-12M」 이 글자순으로 뒤집히지 않게 숫자로 맞춘다. */
export function periodSortKey(grain: BreakdownGrain, period: string): string {
  const y = period.slice(0, 4);
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (grain) {
    case 'quarter':
      return `${y}-${pad(Number(period.slice(-1)) * 3)}`;
    case 'half':
      return `${y}-${period.endsWith('H1') ? '06' : '12'}`;
    case 'ytd':
      return `${y}-${pad(parseInt(period.slice(5), 10))}`;
    case 'year':
      return `${y}-12`;
    default:
      return period; // month(YYYY-MM) · asof(YYYY-MM-DD) 는 글자순 = 시간순
  }
}

/** 축·표 머리용 짧은 기간 이름 — 26Q3 · 26H1 · 26 1~9월 · 2025 · 26.10 · 26.09.30. */
export function breakdownPeriodLabel(grain: BreakdownGrain, period: string): string {
  const yy = period.slice(2, 4);
  switch (grain) {
    case 'quarter':
      return `${yy}Q${period.slice(-1)}`;
    case 'half':
      return `${yy}${period.slice(5)}`;
    case 'ytd':
      return `${yy} 1~${parseInt(period.slice(5), 10)}월`;
    case 'year':
      return period;
    case 'month':
      return `${yy}.${period.slice(5)}`;
    default:
      return `${yy}.${period.slice(5).replace('-', '.')}`;
  }
}

const GRAIN_PREFERENCE: BreakdownGrain[] = ['quarter', 'half', 'year', 'ytd', 'month', 'asof'];

/**
 * 분기 «흐름» 인가 — 2개 이상이고 서로 다른 분기 번호(Q1·Q2…)가 섞여야 한다.
 * 1분기 보고서의 「25Q1 vs 26Q1」 두 값뿐이면 흐름이 아니라 전년 비교다 — 그걸 분기 차트로 고르면
 * 반기·누계·연간 값이 다 있는데도 1분기 막대 둘만 남는다(폭스바겐 · 2026-11-12 사용자 지적).
 */
export function isQuarterSeries(periods: Iterable<string> | undefined): boolean {
  const ps = [...(periods ?? [])];
  return ps.length >= 2 && new Set(ps.map((p) => p.slice(-1))).size >= 2;
}

/** 전년 동기 — 분기·반기·누계·월은 같은 꼬리의 한 해 전 · 연간은 한 해 전 · 시점은 없음. */
export function prevPeriod(grain: BreakdownGrain, period: string): string | null {
  if (grain === 'asof') return null;
  return `${Number(period.slice(0, 4)) - 1}${period.slice(4)}`;
}

/** 표의 차이(%p) · 차트의 증감률(%) — 소수 한 자리. */
const round1 = (v: number) => Math.round(v * 10) / 10;

/** 차트 기간 꼴 하나 — 분기 흐름이면 분기 · 아니면 연간 · 그것도 없으면 기간이 가장 많은 꼴(같으면 위 순서). */
export function pickGrain(periodsByGrain: Map<BreakdownGrain, Set<string>>): BreakdownGrain | null {
  if (isQuarterSeries(periodsByGrain.get('quarter'))) return 'quarter';
  if ((periodsByGrain.get('year')?.size ?? 0) >= 1) return 'year';
  let best: BreakdownGrain | null = null;
  for (const g of GRAIN_PREFERENCE) {
    const n = periodsByGrain.get(g)?.size ?? 0;
    if (n > 0 && (best == null || n > (periodsByGrain.get(best)?.size ?? 0))) best = g;
  }
  return best;
}

/** 최근 공시가 먼저 — 같은 날이면 문서 id 큰 것. */
function newer(a: BreakdownRow, b: BreakdownRow): boolean {
  return a.published_at !== b.published_at
    ? a.published_at > b.published_at
    : a.document_id > b.document_id;
}

/**
 * 한 문서·한 기간 안에서 상위 라벨이 있으면 하위 라벨을 뺀다 — 팩트시트가 「Macan」 과 「Macan BEV」·「Macan ICE」 를 함께 싣는다.
 * 하위 합이 상위 값 이하(1% 여유)일 때만 뺀다 — 「VF 8」 과 「VF 8 Plus」 처럼 이름만 겹치는 형제는 남긴다.
 * SHORTCUT: 원문 표기의 「상위 이름 + 공백」 접두로만 가른다 → 접두가 아닌 계층(북미 ↔ 미국 · 브랜드그룹 ↔ 산하 브랜드)은
 * 적재 때 하위 행 metric 을 `<metric>_detail` 로 갈라 둔다(llm_breakdown 규칙 9 · 놓치면 customer_breakdown.suspect_parent_sums 가 경고).
 * 계층이 더 생기면 표에 parent 칸을 두는 쪽으로 올린다.
 */
export function dropSubLabels(rows: BreakdownRow[]): BreakdownRow[] {
  const drop = new Set<BreakdownRow>();
  for (const p of rows) {
    const kids = rows.filter((r) => r !== p && r.label_raw.startsWith(`${p.label_raw} `));
    if (kids.length > 0 && kids.reduce((s, r) => s + r.value, 0) <= p.value * 1.01)
      kids.forEach((r) => drop.add(r));
  }
  return rows.filter((r) => !drop.has(r));
}

const CHART_PERIODS = 12;

type Picked = Map<string, BreakdownRow[]>;
type ChartUnit = (typeof CHART_UNITS)[string];

/** 기간마다 문서 하나 — 하위 라벨을 뺀 뒤 구분이 가장 많은 문서, 같으면 최신(«한 기간 = 한 문서»). */
function pickPerPeriod(rows: BreakdownRow[], grain: BreakdownGrain): Picked {
  const byPeriod = new Map<string, BreakdownRow[]>();
  for (const r of rows)
    if (r.period_grain === grain) byPeriod.set(r.period, [...(byPeriod.get(r.period) ?? []), r]);
  const out: Picked = new Map();
  for (const [period, inPeriod] of byPeriod) {
    const byDoc = new Map<number, BreakdownRow[]>();
    for (const r of inPeriod) byDoc.set(r.document_id, [...(byDoc.get(r.document_id) ?? []), r]);
    const pick = [...byDoc.values()]
      .map(dropSubLabels)
      .sort((a, b) =>
        b.length !== a.length ? b.length - a.length : newer(b[0], a[0]) ? 1 : -1
      )[0];
    out.set(period, pick);
  }
  return out;
}

const sortPeriods = (grain: BreakdownGrain, ps: Iterable<string>) =>
  [...ps].sort((a, b) => periodSortKey(grain, a).localeCompare(periodSortKey(grain, b)));

function sumByLabel(rows: BreakdownRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.label_ko, (out.get(r.label_ko) ?? 0) + r.value);
  return out;
}

/** 증감률(%) — 전년 값이 0 이하·없으면 null. */
function growthPct(cur: number, prev: number | undefined): number | null {
  return prev != null && prev > 0 ? round1((cur / prev - 1) * 100) : null;
}

/** 막대 하나 — 합은 원래 값으로(칸마다 반올림한 값을 더하면 합계가 어긋난다) · 전년 동기가 있으면 YoY 를 싣는다. */
function pointOf(
  period: string,
  label: string,
  rows: BreakdownRow[],
  u: ChartUnit,
  prev: { label: string; rows: BreakdownRow[] } | null
): HyundaiQuarterlyRegionPoint {
  const round = (v: number) => Number(v.toFixed(u.digits));
  const raw = sumByLabel(rows);
  const totalRaw = [...raw.values()].reduce((s, v) => s + v, 0);
  const point: HyundaiQuarterlyRegionPoint = {
    period,
    period_label: label,
    total: round(totalRaw / u.div),
    regions: Object.fromEntries([...raw].map(([k, v]) => [k, round(v / u.div)])),
  };
  if (!prev) return point;
  const p = sumByLabel(prev.rows);
  const regions: Record<string, number> = {};
  for (const [k, v] of raw) {
    const g = growthPct(v, p.get(k));
    if (g != null) regions[k] = g;
  }
  // 합계 YoY 는 구분 이름이 같을 때만 — 모비스 2026 분기 문서엔 「한국」 이 없어 합끼리 대면 −40% 가 된다(2026-11-12 실측).
  const sameNames = raw.size === p.size && [...raw.keys()].every((k) => p.has(k));
  const total = sameNames
    ? growthPct(
        totalRaw,
        [...p.values()].reduce((s, v) => s + v, 0)
      )
    : null;
  return { ...point, yoy: { label: prev.label, total, regions } };
}

/**
 * 출처에 넣을 전년 행 — 올해 막대에 있는 구분만(그 구분의 YoY 만 그린다 · 이름이 다 같을 때의 합계 YoY 도 이 행들뿐이다).
 * 올해에 없는 구분의 전년 행까지 넣으면 화면에 안 보이는 값의 쪽·용어가 출처·뜻 상자에 섞인다(Codex 검토 2026-11-12).
 */
function prevShown(cur: BreakdownRow[], prev: BreakdownRow[] | undefined): BreakdownRow[] {
  const names = new Set(cur.map((r) => r.label_ko));
  return (prev ?? []).filter((r) => names.has(r.label_ko));
}

/** 한 꼴의 흐름(분기·월·반기…) — 최근 CHART_PERIODS 개 · 전년 동기는 잘린 앞 기간에서도 찾는다. */
function seriesView(
  grain: BreakdownGrain,
  picked: Picked,
  u: ChartUnit,
  used: BreakdownRow[]
): BreakdownChartView | null {
  const ps = sortPeriods(grain, picked.keys()).slice(-CHART_PERIODS);
  if (ps.length === 0) return null;
  const data = ps.map((p) => {
    const pp = prevPeriod(grain, p);
    const prevRows = pp ? picked.get(pp) : undefined;
    used.push(...picked.get(p)!, ...prevShown(picked.get(p)!, prevRows));
    return pointOf(
      p,
      breakdownPeriodLabel(grain, p),
      picked.get(p)!,
      u,
      prevRows ? { label: breakdownPeriodLabel(grain, pp!), rows: prevRows } : null
    );
  });
  return { key: grain, label: GRAIN_LABEL[grain], data, note: null };
}

type YtdHow = 'reported' | 'half' | 'quarters';
const YTD_HOW: Record<YtdHow, string> = {
  reported: '회사 발표 누계',
  half: '회사 발표 상반기',
  quarters: '발표된 분기 합',
};

/**
 * 그 해 1~N월 누계 — 회사 발표 누계 > 상반기 > 분기 합.
 * 분기 합은 Q1 부터 빠짐없이 · 구분 이름이 분기마다 같을 때만(이름이 바뀐 분기를 더하면 계열이 빈다).
 * month 를 주면 그 달까지의 누계만 찾는다(전년 동기 비교용) · 안 주면 12월 전까지 가장 긴 것.
 */
function ytdOf(
  year: number,
  maps: { ytd: Picked; half: Picked; quarter: Picked },
  month?: number
): { month: number; rows: BreakdownRow[]; how: YtdHow } | null {
  const cands: { month: number; rows: BreakdownRow[]; how: YtdHow }[] = [];
  for (const [period, rows] of maps.ytd)
    if (period.startsWith(`${year}-`))
      cands.push({ month: parseInt(period.slice(5), 10), rows, how: 'reported' });
  const h1 = maps.half.get(`${year}-H1`);
  if (h1) cands.push({ month: 6, rows: h1, how: 'half' });
  let n = 0;
  while (n < 4 && maps.quarter.has(`${year}-Q${n + 1}`)) n++;
  // 분기 합 — 최신 분기의 구분 이름이 바뀌었으면 이름이 같은 앞 분기까지로 물러선다(Q3 에 유럽이 새로 생겨도 1~6월은 낸다).
  const ks = month == null ? [3, 2, 1].filter((k) => k <= n) : [month / 3]; // 4분기 합은 연간(yearOf)
  for (const k of ks) {
    const summed = Number.isInteger(k) && k >= 1 ? quarterSum(year, k, maps.quarter) : null;
    if (summed) {
      cands.push({ month: k * 3, rows: summed, how: 'quarters' });
      break;
    }
  }
  return (
    cands
      .filter((c) => (month == null ? c.month < 12 : c.month === month))
      .sort(
        (a, b) =>
          nameCount(b.rows) - nameCount(a.rows) || b.month - a.month || rank[a.how] - rank[b.how]
      )[0] ?? null
  );
}

const rank: Record<YtdHow, number> = { reported: 0, half: 1, quarters: 2 };
/** 구분 수 — 후보가 여럿이면 구분이 많은 쪽(포르쉐 누계 발표는 「북미」 하나뿐이고 분기 합은 전 지역이다). */
const nameCount = (rs: BreakdownRow[]) => new Set(rs.map((r) => r.label_ko)).size;

/** 분기 합 — Q1~Qk 가 빠짐없고 분기마다 구분 이름이 같을 때만(이름이 바뀐 분기를 더하면 계열이 빈다). */
function quarterSum(year: number, k: number, quarter: Picked): BreakdownRow[] | null {
  const head: BreakdownRow[][] = [];
  for (let q = 1; q <= k; q++) {
    const rs = quarter.get(`${year}-Q${q}`);
    if (!rs) return null;
    head.push(rs);
  }
  const names = (rs: BreakdownRow[]) =>
    [...new Set(rs.map((r) => r.label_ko))].sort().join('\u0000');
  return head.every((rs) => names(rs) === names(head[0])) ? head.flat() : null;
}

/** 한 해 연간 값 — 회사 발표 연간(없으면 12개월 누계) · Q1~Q4 분기 합 중 구분이 많은 쪽(같으면 발표). */
function yearOf(
  year: number,
  years: Picked,
  maps: { ytd: Picked; quarter: Picked }
): { rows: BreakdownRow[]; how: 'reported' | 'quarters' } | null {
  const reported = years.get(String(year)) ?? maps.ytd.get(`${year}-12M`);
  const summed = quarterSum(year, 4, maps.quarter);
  if (reported && (!summed || nameCount(reported) >= nameCount(summed)))
    return { rows: reported, how: 'reported' };
  return summed ? { rows: summed, how: 'quarters' } : null;
}

const ytdLabel = (year: number, month: number) => breakdownPeriodLabel('ytd', `${year}-${month}M`);
const latestYear = (rows: BreakdownRow[]) =>
  Math.max(...rows.map((r) => Number(r.period.slice(0, 4))));

/** 연간 보기 — 연도 막대 + 마지막 해의 연간 값이 아직 없으면 그 해 누계 막대(전년 같은 달까지와 YoY). */
function annualView(
  rows: BreakdownRow[],
  maps: { ytd: Picked; half: Picked; quarter: Picked },
  u: ChartUnit,
  used: BreakdownRow[]
): BreakdownChartView | null {
  const reported = pickPerPeriod(rows, 'year');
  // 연간 값 = 발표 연간(또는 12개월 누계) 또는 Q1~Q4 분기 합(연간 발표가 없거나 구분이 적은 해 — 포르쉐 지역·폴라리스 지역).
  const yearsWith = new Set([
    ...reported.keys(),
    ...[...maps.ytd.keys()].filter((p) => p.endsWith('-12M')).map((p) => p.slice(0, 4)),
    ...[...maps.quarter.keys()].map((p) => p.slice(0, 4)),
  ]);
  const years = new Map<number, { rows: BreakdownRow[]; how: 'reported' | 'quarters' }>();
  for (const y of yearsWith) {
    const v = yearOf(Number(y), reported, maps);
    if (v) years.set(Number(y), v);
  }
  const data = [...years.keys()]
    .sort((a, b) => a - b)
    .map((y) => {
      const prev = years.get(y - 1);
      used.push(...years.get(y)!.rows, ...prevShown(years.get(y)!.rows, prev?.rows));
      return pointOf(
        String(y),
        String(y),
        years.get(y)!.rows,
        u,
        prev ? { label: String(y - 1), rows: prev.rows } : null
      );
    });
  const summedYears = [...years]
    .filter(([, v]) => v.how === 'quarters')
    .map(([y]) => y)
    .sort();
  const notes: string[] = [];
  if (summedYears.length > 0) notes.push(`${summedYears.join('·')} = ${YTD_HOW.quarters}`);
  // 연도는 데이터에서 — 연초엔 지난해 연간 값이 아직 없어 지난해 누계가 마지막 막대다(CLAUDE 「연도를 박지 말 것」).
  const last = latestYear(rows);
  const cur = years.has(last) ? null : ytdOf(last, maps);
  if (cur) {
    const prev = ytdOf(last - 1, maps, cur.month);
    used.push(...cur.rows, ...prevShown(cur.rows, prev?.rows));
    data.push(
      pointOf(
        `${last}-YTD`,
        ytdLabel(last, cur.month),
        cur.rows,
        u,
        prev ? { label: ytdLabel(last - 1, cur.month), rows: prev.rows } : null
      )
    );
    notes.push(`${ytdLabel(last, cur.month)} = ${YTD_HOW[cur.how]}`);
  }
  if (data.length === 0) return null;
  return { key: 'annual', label: '연간', data, note: notes.length > 0 ? notes.join(' · ') : null };
}

/**
 * 대수·매출 차트 — 보기 = 분기(흐름일 때) · 연간(연도 + 올해 누계).
 * 둘 다 없거나 연간이 막대 하나뿐이면 분기·월·반기·시점 중 기간이 가장 많은 꼴(2개 이상 · 연간도 없으면 1개도)을 앞에 둔다.
 * 분기도 후보다 — 흐름이 아닌 「25Q2·26Q2」나 단독 Q2 는 연간·누계를 못 만들면 갈 곳이 없어 사라졌다(Codex 검토 2026-11-12).
 */
function chartOf(
  key: string,
  title: string,
  rows: BreakdownRow[],
  used: BreakdownRow[]
): BreakdownChart | null {
  const u = CHART_UNITS[rows[0].unit];
  const maps = {
    quarter: pickPerPeriod(rows, 'quarter'),
    half: pickPerPeriod(rows, 'half'),
    ytd: pickPerPeriod(rows, 'ytd'),
  };
  const views: BreakdownChartView[] = [];
  if (isQuarterSeries(maps.quarter.keys())) {
    const v = seriesView('quarter', maps.quarter, u, used);
    if (v) views.push(v);
  }
  const annual = annualView(rows, maps, u, used);
  if (views.length === 0 && (annual?.data.length ?? 0) < 2) {
    const other = (['quarter', 'month', 'half', 'asof'] as const)
      .map((g) => ({ g, picked: g === 'month' || g === 'asof' ? pickPerPeriod(rows, g) : maps[g] }))
      .filter((x) => x.picked.size >= (annual ? 2 : 1))
      .sort((a, b) => b.picked.size - a.picked.size)[0];
    const v = other ? seriesView(other.g, other.picked, u, used) : null;
    if (v) views.push(v);
  }
  if (annual) views.push(annual);
  if (views.length === 0) return null;
  return { key, title: `${title} (${u.label})`, unit: { label: u.label, tick: u.tick }, views };
}

const TABLE_COLUMNS = 8;

/** 표 칸 하나의 꼴·기간 — 연간 표 끝에 붙는 올해 누계 칸은 누계(또는 상반기·1분기) 꼴이고 months(1~N월)를 단다. */
interface TableCol {
  grain: BreakdownGrain;
  period: string;
  label: string;
  months?: number;
}

/**
 * 전년 동기 칸 후보 — 같은 꼴이 먼저. 누계 칸은 같은 달 수의 다른 꼴도 본다
 * (올해 「1~6월 누계」 ↔ 전년 「상반기」 · 「1~3월」 ↔ 「1분기」 — 회사가 해마다 표기를 바꾼다).
 */
function prevCols(c: TableCol): { grain: BreakdownGrain; period: string }[] {
  const pp = prevPeriod(c.grain, c.period);
  const out = pp ? [{ grain: c.grain, period: pp }] : [];
  if (c.months == null) return out;
  const y = Number(c.period.slice(0, 4)) - 1;
  const alts: { grain: BreakdownGrain; period: string }[] = [
    { grain: 'ytd', period: `${y}-${c.months}M` },
    ...(c.months === 6 ? [{ grain: 'half' as const, period: `${y}-H1` }] : []),
    ...(c.months === 3 ? [{ grain: 'quarter' as const, period: `${y}-Q1` }] : []),
  ];
  return [...out, ...alts.filter((a) => a.grain !== c.grain)];
}

/**
 * 구성비·점유율 표 — 칸(라벨 × 기간)마다 가장 최근 공시 값. extra = 끝에 붙일 칸(연간 표의 올해 누계).
 * 칸마다 전년 동기 대비 차이(%p)를 함께 싣는다(호버).
 */
function tableOf(
  key: string,
  title: string,
  rows: BreakdownRow[],
  grain: BreakdownGrain,
  used: BreakdownRow[],
  extra: TableCol | null = null
): BreakdownTable | null {
  const cell = new Map<string, BreakdownRow>();
  for (const r of rows) {
    const k = `${r.period_grain}\u0000${r.label_ko}\u0000${r.period}`;
    const cur = cell.get(k);
    if (!cur || newer(r, cur)) cell.set(k, r);
  }
  const at = (c: { grain: BreakdownGrain; period: string }, label: string) =>
    cell.get(`${c.grain}\u0000${label}\u0000${c.period}`);
  const periods = sortPeriods(
    grain,
    new Set(rows.filter((r) => r.period_grain === grain).map((r) => r.period))
  ).slice(-TABLE_COLUMNS);
  if (periods.length === 0) return null;
  const cols: TableCol[] = periods.map((p) => ({
    grain,
    period: p,
    label: breakdownPeriodLabel(grain, p),
  }));
  if (extra) cols.push(extra);
  const atPrev = (c: TableCol, label: string) =>
    prevCols(c)
      .map((pc) => at(pc, label))
      .find((r) => r != null);
  const labels = [
    ...new Set(
      cols.flatMap((c) =>
        rows
          .filter((r) => r.period_grain === c.grain && r.period === c.period)
          .map((r) => r.label_ko)
      )
    ),
  ];
  const tableRows = labels
    .map((label) => {
      const values = cols.map((c) => at(c, label)?.value ?? null);
      const yoy = cols.map((c, i) => {
        const prev = atPrev(c, label);
        return values[i] != null && prev ? round1(values[i]! - prev.value) : null;
      });
      return { label, values, yoy };
    })
    .filter((r) => r.values.some((v) => v != null));
  // 최근 칸 값이 큰 라벨이 위(값이 없으면 아래).
  const lastFilled = (vs: (number | null)[]) =>
    [...vs].reverse().find((v) => v != null) ?? -Infinity;
  tableRows.sort((a, b) => lastFilled(b.values) - lastFilled(a.values));
  if (tableRows.length === 0) return null;
  for (const c of cols)
    for (const { label } of tableRows) {
      const r = at(c, label);
      if (r) used.push(r);
      const p = r ? atPrev(c, label) : undefined;
      if (p) used.push(p);
    }
  return {
    key,
    title: `${title} (${GRAIN_LABEL[grain]})`,
    unitLabel: '%',
    columns: cols.map((c) => {
      const pp = prevPeriod(c.grain, c.period);
      return {
        period: `${c.grain}:${c.period}`,
        label: c.label,
        prevLabel:
          c.months != null
            ? ytdLabel(Number(c.period.slice(0, 4)) - 1, c.months)
            : pp == null
              ? null
              : breakdownPeriodLabel(c.grain, pp),
      };
    }),
    rows: tableRows,
  };
}

/**
 * 구성비·점유율의 올해 누계 칸 — 마지막 해의 연간 값이 아직 없을 때만 · 회사 발표 누계(가장 긴 것) > 상반기 >
 * 1분기(그 해 분기가 Q1 뿐일 때 — 1분기는 그 자체로 1~3월 누계다). %는 더할 수 없어 분기 합은 없다.
 */
function pctYtdCol(rows: BreakdownRow[]): TableCol | null {
  const last = latestYear(rows);
  const has = (g: BreakdownGrain, p: string) =>
    rows.some((r) => r.period_grain === g && r.period === p);
  if (has('year', String(last))) return null;
  const ytd = sortPeriods(
    'ytd',
    new Set(
      rows
        .filter((r) => r.period_grain === 'ytd' && r.period.startsWith(`${last}-`))
        .map((r) => r.period)
    )
  ).at(-1);
  if (ytd)
    return {
      grain: 'ytd',
      period: ytd,
      label: breakdownPeriodLabel('ytd', ytd),
      months: parseInt(ytd.slice(5), 10),
    };
  if (has('half', `${last}-H1`))
    return { grain: 'half', period: `${last}-H1`, label: ytdLabel(last, 6), months: 6 };
  const quarters = rows.filter(
    (r) => r.period_grain === 'quarter' && r.period.startsWith(`${last}-`)
  );
  if (quarters.length > 0 && quarters.every((r) => r.period === `${last}-Q1`))
    return { grain: 'quarter', period: `${last}-Q1`, label: ytdLabel(last, 3), months: 3 };
  return null;
}

function termsOf(rows: BreakdownRow[]): BreakdownTerm[] {
  const out = new Map<string, { raw: Set<string>; def: BreakdownRow | null }>();
  for (const r of rows) {
    const t = out.get(r.label_ko) ?? { raw: new Set<string>(), def: null };
    t.raw.add(r.label_raw);
    if (r.definition && (!t.def || newer(r, t.def))) t.def = r;
    out.set(r.label_ko, t);
  }
  return [...out].map(([label, t]) => ({
    label,
    raw: [...t.raw].filter((x) => x !== label).sort(),
    definition: t.def?.definition ?? null,
  }));
}

/** 출처 = 화면에 실제로 그린 행의 문서·쪽(개수 상한 없음 — 잘라 내면 보이는 값의 출처가 빠진다). 최신 문서부터. */
function sourcesOf(rows: BreakdownRow[]): BreakdownSource[] {
  const out = new Map<number, BreakdownSource>();
  for (const r of rows) {
    const s = out.get(r.document_id) ?? {
      docId: r.document_id,
      title: r.doc_title ?? `문서 ${r.document_id}`,
      url: r.doc_url,
      publishedAt: r.published_at,
      pages: [],
    };
    if (r.page != null && !s.pages.includes(r.page)) s.pages.push(r.page);
    out.set(r.document_id, s);
  }
  return [...out.values()]
    .map((s) => ({ ...s, pages: s.pages.sort((a, b) => a - b) }))
    .sort((a, b) =>
      a.publishedAt !== b.publishedAt ? (a.publishedAt < b.publishedAt ? 1 : -1) : b.docId - a.docId
    );
}

export const KINDS: BreakdownKind[] = ['region', 'model', 'share'];

/** 탭 목록 — 값이 없는 탭은 빠진다(결정 C4). */
export function buildBreakdown(rows: BreakdownRow[]): BreakdownTab[] {
  const tabs: BreakdownTab[] = [];
  for (const kind of KINDS) {
    const inKind = rows.filter((r) => r.kind === kind);
    if (inKind.length === 0) continue;
    const groups = new Map<string, BreakdownRow[]>();
    for (const r of inKind) {
      const k = `${r.metric}|${r.unit}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    const charts: BreakdownChart[] = [];
    const tables: BreakdownTable[] = [];
    const used: BreakdownRow[] = [];
    for (const [k, g] of groups) {
      const grains = new Map<BreakdownGrain, Set<string>>();
      for (const r of g)
        grains.set(r.period_grain, (grains.get(r.period_grain) ?? new Set()).add(r.period));
      const title = metricLabel(g[0].metric, g[0].unit);
      if (isPercent(g[0].unit)) {
        const grain = pickGrain(grains);
        if (!grain) continue;
        // 표 = 고른 꼴 + 분기(있으면 — 최신 분기 하나뿐이라 연간을 골라도 그 분기가 사라지지 않게) + 연간(긴 흐름).
        const tableGrains = [
          ...new Set<BreakdownGrain>([
            grain,
            ...(['quarter', 'year'] as const).filter((x) => grains.has(x)),
          ]),
        ];
        // 올해 누계 칸 — 연간 표 끝에 붙인다 · 연간 표가 없으면 그 꼴(누계·반기) 표를 따로 둔다.
        const ytd = pctYtdCol(g);
        if (ytd && !tableGrains.includes('year') && !tableGrains.includes(ytd.grain))
          tableGrains.push(ytd.grain);
        for (const gr of tableGrains) {
          const t = tableOf(`${kind}|${k}|${gr}`, title, g, gr, used, gr === 'year' ? ytd : null);
          if (t) tables.push(t);
        }
      } else {
        const c = chartOf(`${kind}|${k}`, title, g, used);
        if (c) charts.push(c);
      }
    }
    if (charts.length + tables.length === 0) continue;
    tabs.push({
      kind,
      title: KIND_TITLE[kind],
      charts,
      tables,
      terms: termsOf(used),
      sources: sourcesOf(used),
    });
  }
  return tabs;
}
