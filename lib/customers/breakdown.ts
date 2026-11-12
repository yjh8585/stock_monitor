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

export interface BreakdownChart {
  key: string;
  title: string;
  /** HyundaiQuarterlyRegionsChart 의 unit 인자 그대로. */
  unit: { label: string; tick: 'thousand_units' | 'plain' };
  data: HyundaiQuarterlyRegionPoint[];
}

export interface BreakdownTable {
  key: string;
  title: string;
  unitLabel: string;
  columns: { period: string; label: string }[];
  rows: { label: string; values: (number | null)[] }[];
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

/** 차트 기간 꼴 하나 — 분기 2개 이상이면 분기 · 아니면 연간 · 그것도 없으면 기간이 가장 많은 꼴(같으면 위 순서). */
export function pickGrain(periodsByGrain: Map<BreakdownGrain, Set<string>>): BreakdownGrain | null {
  if ((periodsByGrain.get('quarter')?.size ?? 0) >= 2) return 'quarter';
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

/** 차트 하나 — 실제로 그린 행은 `used` 에 넣는다(출처·뜻 상자가 화면과 같은 행을 보게). */
function chartOf(
  key: string,
  title: string,
  rows: BreakdownRow[],
  grain: BreakdownGrain,
  used: BreakdownRow[]
): BreakdownChart | null {
  const u = CHART_UNITS[rows[0].unit];
  const byPeriod = new Map<string, BreakdownRow[]>();
  for (const r of rows)
    if (r.period_grain === grain) byPeriod.set(r.period, [...(byPeriod.get(r.period) ?? []), r]);
  const picked: { period: string; rows: BreakdownRow[] }[] = [];
  for (const [period, inPeriod] of byPeriod) {
    // 한 기간 = 한 문서 — 하위 라벨을 뺀 뒤 구분이 가장 많은 문서, 같으면 최신.
    const byDoc = new Map<number, BreakdownRow[]>();
    for (const r of inPeriod) byDoc.set(r.document_id, [...(byDoc.get(r.document_id) ?? []), r]);
    const pick = [...byDoc.values()]
      .map(dropSubLabels)
      .sort((a, b) =>
        b.length !== a.length ? b.length - a.length : newer(b[0], a[0]) ? 1 : -1
      )[0];
    picked.push({ period, rows: pick });
  }
  if (picked.length === 0) return null;
  picked.sort((a, b) =>
    periodSortKey(grain, a.period).localeCompare(periodSortKey(grain, b.period))
  );
  const round = (v: number) => Number(v.toFixed(u.digits));
  const data: HyundaiQuarterlyRegionPoint[] = picked.slice(-CHART_PERIODS).map((p) => {
    used.push(...p.rows);
    // 합은 원래 값으로 — 칸마다 반올림한 값을 더하면 합계가 어긋난다.
    const raw: Record<string, number> = {};
    for (const r of p.rows) raw[r.label_ko] = (raw[r.label_ko] ?? 0) + r.value / u.div;
    const regions = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, round(v)]));
    const total = round(Object.values(raw).reduce((s, v) => s + v, 0));
    return {
      period: p.period,
      period_label: breakdownPeriodLabel(grain, p.period),
      total,
      regions,
    };
  });
  return {
    key,
    title: `${title} (${GRAIN_LABEL[grain]} · ${u.label})`,
    unit: { label: u.label, tick: u.tick },
    data,
  };
}

const TABLE_COLUMNS = 8;

function tableOf(
  key: string,
  title: string,
  rows: BreakdownRow[],
  grain: BreakdownGrain,
  used: BreakdownRow[]
): BreakdownTable | null {
  // 칸(라벨 × 기간)마다 가장 최근 공시 값.
  const cell = new Map<string, BreakdownRow>();
  for (const r of rows) {
    if (r.period_grain !== grain) continue;
    const k = `${r.label_ko}\u0000${r.period}`;
    const cur = cell.get(k);
    if (!cur || newer(r, cur)) cell.set(k, r);
  }
  if (cell.size === 0) return null;
  const periods = [...new Set([...cell.values()].map((r) => r.period))]
    .sort((a, b) => periodSortKey(grain, a).localeCompare(periodSortKey(grain, b)))
    .slice(-TABLE_COLUMNS);
  const labels = [...new Set([...cell.values()].map((r) => r.label_ko))];
  const tableRows = labels
    .map((label) => ({
      label,
      values: periods.map((p) => cell.get(`${label}\u0000${p}`)?.value ?? null),
    }))
    .filter((r) => r.values.some((v) => v != null));
  // 최근 칸 값이 큰 라벨이 위(값이 없으면 아래).
  const lastFilled = (vs: (number | null)[]) =>
    [...vs].reverse().find((v) => v != null) ?? -Infinity;
  tableRows.sort((a, b) => lastFilled(b.values) - lastFilled(a.values));
  if (tableRows.length === 0) return null;
  const shown = new Set(tableRows.map((r) => r.label));
  for (const p of periods)
    for (const label of shown) {
      const r = cell.get(`${label}\u0000${p}`);
      if (r) used.push(r);
    }
  return {
    key,
    title: `${title} (${GRAIN_LABEL[grain]})`,
    unitLabel: '%',
    columns: periods.map((p) => ({ period: p, label: breakdownPeriodLabel(grain, p) })),
    rows: tableRows,
  };
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
      const grain = pickGrain(grains);
      if (!grain) continue;
      const title = metricLabel(g[0].metric, g[0].unit);
      if (isPercent(g[0].unit)) {
        // 표 = 고른 꼴 + 분기(있으면 — 최신 분기 하나뿐이라 연간을 골라도 그 분기가 사라지지 않게) + 연간(긴 흐름).
        const tableGrains = [
          ...new Set<BreakdownGrain>([
            grain,
            ...(['quarter', 'year'] as const).filter((x) => grains.has(x)),
          ]),
        ];
        for (const gr of tableGrains) {
          const t = tableOf(`${kind}|${k}|${gr}`, title, g, gr, used);
          if (t) tables.push(t);
        }
      } else {
        const c = chartOf(`${kind}|${k}|${grain}`, title, g, grain, used);
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
