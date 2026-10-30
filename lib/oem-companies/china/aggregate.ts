/**
 * 중국 탭(/oem/china) 사전 가공 — pure 함수만.
 *
 * 화면은 새 차트를 만들지 않고 「전체」 탭·회사 탭의 기존 차트를 그대로 쓴다(사용자 지시 2026-10-30
 * 「있는 차트양식 최대한 참고」 · 짝짓기 표 = 계획서 「화면」). 그래서 여기서는 원본 행(생산 약 6만 · 수출 약 2만)을
 * **그 차트들이 받는 모양**으로 바꾼다 — 회사 탭 공용(KPI · 파워트레인 · 모델 TOP · 내수/수출)은 집계 결과로,
 * 전체 탭 순위 차트(TOP30 · TOP40 · YoY 승패 · 차종 구조)는 (묶음, 월) 합계 행으로.
 * 원본 행은 캐시·props 에 싣지 않는다(ISR Write — docs/isr-write-optimization.md).
 *
 * 기간은 **데이터에서 파생**한다(lib/currentYear 규칙의 「적재가 화면보다 늦는 표」 갈래).
 * YTD 의 끝 = 생산·수출 최신월 중 **이른 쪽**(공통 앵커) — 각자 최신월을 쓰면 내수 추정에
 * 한쪽만 한 달이 더 담겨 어긋난다.
 *
 * 테스트 = `aggregate.test.ts`. 경위·결정 = docs/plans/2026-10-29-oem-china-tab.md
 */
import { ymLabel } from '@/components/oem/helpers';
import { growthPct } from '@/lib/format';
import type { KgRegionSeriesPoint } from '@/lib/oem-companies/kg-mobility/aggregate';
import type {
  CompanyKpiSummary,
  CompanyPowertrain,
  CompanyPtMixPoint,
  CompanyTopModelRow,
  CompanyTopModelsResult,
  OemSalesGroupMonth,
  OemSalesTypeSegMonth,
} from '@/lib/types';

export interface ChinaProductionRow {
  cn_group: string;
  maker_brand: string;
  model: string;
  powertrain: string;
  year_month: number;
  production: number;
}

export interface ChinaExportRow {
  cn_group: string;
  brand: string;
  model: string;
  ev_tag: string | null;
  year_month: number;
  export_volume: number;
}

export interface ChinaSegmentRow {
  vehicle_type: string;
  segment: string;
  year_month: number;
  production: number;
}

/** 묶는 단위 토글(결정 6) — 중국 모회사 / 브랜드 */
export type ChinaDim = 'group' | 'brand';

export interface ChinaPeriods {
  /** 공통 앵커 YYYYMM */
  anchorYm: number;
  year: number;
  month: number;
  /** 12월까지 찬 마지막 해 */
  fullYear: number;
  /** '2026 1~9월' */
  ytdLabel: string;
  /** '2025 1~9월' */
  prevYtdLabel: string;
}

export function resolvePeriods(prodMaxYm: number, exportMaxYm: number): ChinaPeriods | null {
  if (!prodMaxYm || !exportMaxYm) return null;
  const anchorYm = Math.min(prodMaxYm, exportMaxYm);
  const year = Math.floor(anchorYm / 100);
  const month = anchorYm % 100;
  return {
    anchorYm,
    year,
    month,
    fullYear: month === 12 ? year : year - 1,
    ytdLabel: `${year} 1~${month}월`,
    prevYtdLabel: `${year - 1} 1~${month}월`,
  };
}

function maxYm(rows: { year_month: number }[]): number {
  let max = 0;
  for (const r of rows) if (r.year_month > max) max = r.year_month;
  return max;
}

/** 이력 시작월 — 화면 머리글의 「YYYY.MM~」를 데이터에서 읽는다(시작 연도를 박지 않는다). 행이 없으면 0 */
export function minYm(rows: { year_month: number }[]): number {
  let min = Infinity;
  for (const r of rows) if (r.year_month < min) min = r.year_month;
  return Number.isFinite(min) ? min : 0;
}

export function periodsOf(prod: ChinaProductionRow[], exp: ChinaExportRow[]): ChinaPeriods | null {
  return resolvePeriods(maxYm(prod), maxYm(exp));
}

/** [from, to] 월 구간을 키별로 합산 */
function sumByKey<T extends { year_month: number }>(
  rows: T[],
  key: (r: T) => string,
  value: (r: T) => number,
  from: number,
  to: number
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.year_month < from || r.year_month > to) continue;
    const k = key(r);
    m.set(k, (m.get(k) ?? 0) + value(r));
  }
  return m;
}

function sumIn<T extends { year_month: number }>(
  rows: T[],
  value: (r: T) => number,
  from: number,
  to: number
): number {
  let s = 0;
  for (const r of rows) if (r.year_month >= from && r.year_month <= to) s += value(r);
  return s;
}

const prodValue = (r: ChinaProductionRow) => r.production;
const exportValue = (r: ChinaExportRow) => r.export_volume;
const PROD_KEY: Record<ChinaDim, (r: ChinaProductionRow) => string> = {
  group: (r) => r.cn_group,
  brand: (r) => r.maker_brand,
};
const EXPORT_KEY: Record<ChinaDim, (r: ChinaExportRow) => string> = {
  group: (r) => r.cn_group,
  brand: (r) => r.brand,
};

const ytdRange = (p: ChinaPeriods): [number, number] => [p.year * 100 + 1, p.anchorYm];
const prevYtdRange = (p: ChinaPeriods): [number, number] => [
  (p.year - 1) * 100 + 1,
  (p.year - 1) * 100 + p.month,
];
const yearRange = (y: number): [number, number] => [y * 100 + 1, y * 100 + 12];

function yearsOf(rows: { year_month: number }[], p: ChinaPeriods): number[] {
  let first = Infinity;
  for (const r of rows) first = Math.min(first, Math.floor(r.year_month / 100));
  if (!Number.isFinite(first)) return [];
  const out: number[] = [];
  for (let y = first; y <= p.year; y++) out.push(y);
  return out;
}

// ─── KPI — 회사 탭 공용 CompanyKpiCards ───────────────────────────────────

/** NEV = EV + PHEV + FCEV (중국 「신에너지차」 정의 = CompanyKpiCards 의 「EV 비중」 정의) */
const NEV_PT = new Set(['EV', 'PHEV', 'FCEV']);

/** 라벨·값 형식은 KG 모빌리티 aggregateKpi 와 같다(12월까지 차면 다음 해 YTD 는 「대기」, 비교 칸은 그해 연간) */
export function buildKpi(prod: ChinaProductionRow[], p: ChinaPeriods): CompanyKpiSummary {
  const latest = sumIn(prod, prodValue, ...yearRange(p.fullYear));
  const prev = sumIn(prod, prodValue, ...yearRange(p.fullYear - 1));
  const nev = sumIn(
    prod,
    (r) => (NEV_PT.has(r.powertrain) ? r.production : 0),
    ...yearRange(p.fullYear)
  );
  const inProgress = p.month < 12;
  const ytd = inProgress ? sumIn(prod, prodValue, ...ytdRange(p)) : 0;
  const ytdPrev = inProgress ? sumIn(prod, prodValue, ...prevYtdRange(p)) : latest;
  return {
    latestYearLabel: `${p.fullYear}년 승용 생산`,
    latestYearSales: latest,
    prevYearLabel: `${p.fullYear - 1}년`,
    prevYearSales: prev,
    yoyPct: growthPct(latest, prev),
    ytdLabel: inProgress ? `${p.year} YTD (1~${p.month}월)` : `${p.year + 1} YTD (대기)`,
    ytdCurrent: ytd,
    ytdPrevLabel: inProgress ? p.prevYtdLabel : `${p.fullYear} 연간`,
    ytdPrev,
    ytdYoyPct: inProgress ? growthPct(ytd, ytdPrev) : null,
    evRatio: latest > 0 ? (nev / latest) * 100 : null,
    latestPeriod: `${p.year}-${String(p.month).padStart(2, '0')}`,
  };
}

// ─── 내수 추정 · 수출 — KG 모빌리티 「내수/수출」 누적 막대 ──────────────────

/**
 * 내수 = 생산 − 수출(재고 증감·수입을 무시한 추정치). 막대 합계(total) = 생산.
 * 연간 라벨은 KG 처럼 연도만 — 'YYYY YTD' 로 길게 쓰면 x축이 바로 앞 해 라벨을 숨긴다(2026-10-30 실측). 누계 기간은 화면 각주가 밝힌다
 */
export function buildFlows(
  prod: ChinaProductionRow[],
  exp: ChinaExportRow[],
  p: ChinaPeriods
): { monthly: KgRegionSeriesPoint[]; annual: KgRegionSeriesPoint[] } {
  const point = (period: string, label: string, production: number, exports: number) => ({
    period,
    period_label: label,
    domestic: production - exports,
    export: exports,
    total: production,
  });

  const prodByYm = sumByKey(prod, (r) => String(r.year_month), prodValue, 0, p.anchorYm);
  const expByYm = sumByKey(exp, (r) => String(r.year_month), exportValue, 0, p.anchorYm);
  const monthly = [...prodByYm.keys()]
    .map(Number)
    .sort((a, b) => a - b)
    .map((ym) =>
      point(String(ym), ymLabel(ym), prodByYm.get(String(ym)) ?? 0, expByYm.get(String(ym)) ?? 0)
    );

  const annual = yearsOf(prod, p).map((y) => {
    const to = Math.min(y * 100 + 12, p.anchorYm);
    return point(
      String(y),
      String(y),
      sumIn(prod, prodValue, y * 100 + 1, to),
      sumIn(exp, exportValue, y * 100 + 1, to)
    );
  });
  return { monthly, annual };
}

// ─── 파워트레인 믹스 — 회사 탭 공용 CompanyPowertrainMixChart ───────────────

type PtMixKey = CompanyPowertrain | 'Unknown';
const PT_KEYS: CompanyPowertrain[] = ['ICE', 'HV', 'PHEV', 'EV', 'FCEV'];

function emptyPt(period: string, label: string): CompanyPtMixPoint {
  return {
    period,
    period_label: label,
    ICE: 0,
    HV: 0,
    PHEV: 0,
    EV: 0,
    FCEV: 0,
    Multi: 0,
    Unknown: 0,
    total: 0,
  };
}

/** 월·연 두 벌을 한 번에 쌓는다 — key 가 null 이면 그 행은 건너뛴다 */
function ptMix<T extends { year_month: number }>(
  rows: T[],
  key: (r: T) => PtMixKey | null,
  value: (r: T) => number,
  p: ChinaPeriods
): { monthly: CompanyPtMixPoint[]; annual: CompanyPtMixPoint[] } {
  const byYm = new Map<number, CompanyPtMixPoint>();
  const byYear = new Map<number, CompanyPtMixPoint>();
  for (const r of rows) {
    const k = key(r);
    if (k == null || r.year_month > p.anchorYm) continue;
    const y = Math.floor(r.year_month / 100);
    if (!byYm.has(r.year_month))
      byYm.set(r.year_month, emptyPt(String(r.year_month), ymLabel(r.year_month)));
    // 연간 라벨은 현대 aggregatePtMixAnnual 처럼 연도만 — 'YYYY YTD' 는 x축에서 앞 해 라벨을 숨긴다
    if (!byYear.has(y)) byYear.set(y, emptyPt(String(y), String(y)));
    for (const point of [byYm.get(r.year_month)!, byYear.get(y)!]) {
      point[k] += value(r);
      point.total += value(r);
    }
  }
  const sorted = (m: Map<number, CompanyPtMixPoint>) =>
    [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  return { monthly: sorted(byYm), annual: sorted(byYear) };
}

/** 생산 파워트레인 — 파서가 정규화한 값 그대로. 모르는 값은 Unknown(차트 범례도 「Unknown」 그대로) */
export function buildPtMix(prod: ChinaProductionRow[], p: ChinaPeriods) {
  return ptMix(
    prod,
    (r) => ((PT_KEYS as string[]).includes(r.powertrain) ? (r.powertrain as PtMixKey) : 'Unknown'),
    prodValue,
    p
  );
}

const TAG_PT: Record<string, Exclude<CompanyPowertrain, 'Multi'>> = {
  EV: 'EV',
  FCV: 'FCEV',
  PHV: 'PHEV',
  PHEV: 'PHEV',
  HV: 'HV',
  MHV: 'HV',
  ICE: 'ICE',
};

/**
 * 수출 EV 열 → 파워트레인 칸. 이 열은 **모델 단위 표기**라 물량이 동력원별로 쪼개지지 않는다 —
 * 동력원이 하나면 그 칸, 둘 이상('EV/PHV/ICE')이면 그 모델 수출 전체가 Multi.
 * 빈 표기·모르는 토큰은 Unknown — 대부분 내연기관차로 보이나 확인되지 않아 ICE 로 넣지 않는다.
 */
export function exportTagPowertrain(tag: string): PtMixKey {
  const raw = tag
    .split('/')
    .map((t) => t.trim())
    .filter(Boolean);
  // `in` 은 'constructor' 같은 프로토타입 키도 참이라 자기 키만 본다
  if (raw.length === 0 || raw.some((t) => !Object.hasOwn(TAG_PT, t))) return 'Unknown';
  const pts = new Set(raw.map((t) => TAG_PT[t]));
  return pts.size === 1 ? [...pts][0] : 'Multi';
}

/** EV 열이 있는 해(2022~)만 — 그 전 시트는 ev_tag 가 null 이다 */
export function buildExportTagMix(exp: ChinaExportRow[], p: ChinaPeriods) {
  return ptMix(
    exp,
    (r) => (r.ev_tag == null ? null : exportTagPowertrain(r.ev_tag)),
    exportValue,
    p
  );
}

// ─── 순위 — 전체 탭 Top30YtdChart · Top40YearlyTable · YoyWinnersLosers ─────

/**
 * 전체 탭 순위 차트가 받는 (묶음, 월) 합계 행. 차트가 읽는 해부터만 싣는다(브랜드×월 전체 이력은 1만 행 — payload).
 * 화면은 차트에 year 를 넘긴다 — TOP30 = p.year YTD 와 그 전해, TOP40·YoY = p.fullYear 와 그 전해.
 */
function groupMonthRows<T extends { year_month: number }>(
  rows: T[],
  key: (r: T) => string,
  value: (r: T) => number,
  p: ChinaPeriods,
  fromYear: number
): OemSalesGroupMonth[] {
  const from = fromYear * 100 + 1;
  const m = new Map<string, OemSalesGroupMonth>();
  for (const r of rows) {
    if (r.year_month < from || r.year_month > p.anchorYm) continue;
    const g = key(r);
    const k = `${g}|${r.year_month}`;
    const row = m.get(k);
    if (row) row.sales += value(r);
    else m.set(k, { oem_group: g, year_month: r.year_month, sales: value(r) });
  }
  return [...m.values()];
}

/** 생산은 TOP30·TOP40·YoY 가 함께 쓴다 — p.fullYear − 1 이 가장 이른 해(p.year − 1 보다 같거나 이르다) */
export function buildProductionGroupMonth(
  prod: ChinaProductionRow[],
  p: ChinaPeriods
): Record<ChinaDim, OemSalesGroupMonth[]> {
  return {
    group: groupMonthRows(prod, PROD_KEY.group, prodValue, p, p.fullYear - 1),
    brand: groupMonthRows(prod, PROD_KEY.brand, prodValue, p, p.fullYear - 1),
  };
}

/** 수출은 TOP30 만 쓴다 — p.year YTD 와 그 전해 같은 기간 */
export function buildExportGroupMonth(
  exp: ChinaExportRow[],
  p: ChinaPeriods
): Record<ChinaDim, OemSalesGroupMonth[]> {
  return {
    group: groupMonthRows(exp, EXPORT_KEY.group, exportValue, p, p.year - 1),
    brand: groupMonthRows(exp, EXPORT_KEY.brand, exportValue, p, p.year - 1),
  };
}

// ─── 차종 구조 — 전체 탭 TypeSegmentChart ────────────────────────────────

/** 차트가 p.fullYear 한 해만 읽으므로(화면이 year 로 넘긴다) 그해만 싣는다 */
export function buildTypeSegMonth(
  rows: ChinaSegmentRow[],
  p: ChinaPeriods
): OemSalesTypeSegMonth[] {
  const [from, to] = yearRange(p.fullYear);
  return rows
    .filter((r) => r.year_month >= from && r.year_month <= to)
    .map((r) => ({
      vehicle_type: r.vehicle_type,
      segment: r.segment,
      year_month: r.year_month,
      sales: r.production,
    }));
}

// ─── 모델 TOP — 회사 탭 공용 CompanyTopModelsTable ────────────────────────

interface ModelAgg {
  label: string;
  brand?: string;
  latest: number;
  prev: number;
  ytd: number;
  ytdPrev: number;
  pts: Set<string>;
}

function topModels<T extends { year_month: number }>(
  rows: T[],
  key: (r: T) => string,
  init: (r: T) => Pick<ModelAgg, 'label' | 'brand'>,
  value: (r: T) => number,
  pt: ((r: T) => string) | null,
  p: ChinaPeriods,
  topN: number
): CompanyTopModelsResult {
  const [lf, lt] = yearRange(p.fullYear);
  const [vf, vt] = yearRange(p.fullYear - 1);
  const [cf, ct] = ytdRange(p);
  const [pf, ptEnd] = prevYtdRange(p);
  // 12월까지 찼으면 YTD = 연간이라 칸이 겹친다 — buildKpi 처럼 YTD 를 비우고(표가 칸을 숨긴다) 연간으로 줄 세운다
  const inProgress = p.month < 12;
  const totals = { latestPeriod: 0, prevPeriod: 0, ytd: 0, ytdPrev: 0 };
  const m = new Map<string, ModelAgg>();
  for (const r of rows) {
    const ym = r.year_month;
    const v = value(r);
    const inLatest = ym >= lf && ym <= lt;
    const inPrev = ym >= vf && ym <= vt;
    const inYtd = inProgress && ym >= cf && ym <= ct;
    const inYtdPrev = inProgress && ym >= pf && ym <= ptEnd;
    if (!inLatest && !inPrev && !inYtd && !inYtdPrev) continue;
    const k = key(r);
    if (!m.has(k)) m.set(k, { ...init(r), latest: 0, prev: 0, ytd: 0, ytdPrev: 0, pts: new Set() });
    const a = m.get(k)!;
    // 동력원 표기는 줄 세우는 기간(진행 중이면 YTD, 아니면 연간)에 실제로 만든 것만
    if (pt && v > 0 && (inProgress ? inYtd : inLatest)) a.pts.add(pt(r));
    if (inLatest) {
      a.latest += v;
      totals.latestPeriod += v;
    }
    if (inPrev) {
      a.prev += v;
      totals.prevPeriod += v;
    }
    if (inYtd) {
      a.ytd += v;
      totals.ytd += v;
    }
    if (inYtdPrev) {
      a.ytdPrev += v;
      totals.ytdPrev += v;
    }
  }
  const resolvedPt = (a: ModelAgg): CompanyPowertrain | null => {
    if (!pt || a.pts.size === 0) return null;
    return a.pts.size === 1 ? ([...a.pts][0] as CompanyPowertrain) : 'Multi';
  };
  const out: CompanyTopModelRow[] = [...m.values()]
    .sort((a, b) => b.ytd - a.ytd || b.latest - a.latest)
    .slice(0, topN)
    .map((a) => ({
      model: a.label,
      salesLatestPeriod: a.latest,
      salesPrevPeriod: a.prev,
      ytdSales: a.ytd,
      ytdPrevSales: a.ytdPrev,
      ytdYoyPct: growthPct(a.ytd, a.ytdPrev),
      yoyPct: growthPct(a.latest, a.prev),
      resolvedPt: resolvedPt(a),
      ...(a.brand ? { brand: a.brand } : {}),
    }));
  return { rows: out, totals };
}

/** 모델명이 브랜드로 시작하지 않으면 붙인다 — 'Song PLUS' → 'BYD Song PLUS', 'Audi A4' 는 그대로 */
export function modelLabel(brand: string, model: string): string {
  return model.toLowerCase().startsWith(brand.toLowerCase()) ? model : `${brand} ${model}`;
}

/** 모델 표 행 수 — 화면 제목(「모델 TOP30」)도 이 값을 쓴다 */
export const PRODUCTION_TOP_MODELS = 30;
export const EXPORT_TOP_MODELS = 20;

export function buildProductionTopModels(prod: ChinaProductionRow[], p: ChinaPeriods) {
  return topModels(
    prod,
    (r) => `${r.maker_brand}|${r.model}`,
    (r) => ({ label: modelLabel(r.maker_brand, r.model) }),
    prodValue,
    (r) => r.powertrain,
    p,
    PRODUCTION_TOP_MODELS
  );
}

export function buildExportTopModels(exp: ChinaExportRow[], p: ChinaPeriods) {
  return topModels(
    exp,
    (r) => `${r.brand}|${r.model}`,
    (r) => ({ label: r.model, brand: r.brand }),
    exportValue,
    null,
    p,
    EXPORT_TOP_MODELS
  );
}
