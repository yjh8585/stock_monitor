import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import logger from '@/lib/logger';
import type {
  BrandInventoryTrend,
  CompetitionMarket,
  CompetitionOutlook,
  CompetitorSales,
  ComponentCount,
  ConsumerScore,
  InventoryPoint,
  MarketBreakdown,
  ModelSeries,
  ModelShareTrend,
  OutlookSource,
  PeriodAggregate,
  PeriodBasis,
  PeriodModelSales,
  SafetyPoint,
} from './types';

type OutlookRow = {
  model_key: string;
  model_name: string;
  oem_group: string;
  note_date: string;
  label: string;
  sales_trend: string | null;
  competitive_view: string | null;
  consumer_view: string;
  outlook: string;
  rationale: string;
  region: string;
  market_breakdown: unknown;
  metrics: unknown;
  sources: unknown;
};

type MonthlyRow = {
  model_key: string;
  market: string;
  model: string;
  is_target: boolean;
  year_month: number;
  sales: number;
};

/**
 * 화면 표시 순서 — 사용자 지정(2026-08-13): 스텔란티스 → 아틀라스 → 리비안 → 포르쉐 → 현대기아.
 * 스텔란티스 안에서는 그랜드체로키가 첫 번째, 그다음은 판매 규모 순.
 * 🔴 정렬을 region 기준으로 되돌리지 말 것 — 지시된 그룹 순서와 어긋난다.
 */
export const MODEL_DISPLAY_ORDER = [
  'grand_cherokee',
  'ram_truck',
  'pacifica',
  'atlas',
  'rivian_r1',
  'porsche_911',
  'avante_ex_china',
  'avante_china',
  'seltos',
  'niro',
] as const;

/** 목록에 없는 차종(새로 추가된 경우)은 뒤로 밀고 그 안에서 사전순 — 순서가 실행마다 흔들리지 않게. */
export function compareForDisplay(
  a: Pick<OutlookRow, 'model_key'>,
  b: Pick<OutlookRow, 'model_key'>
): number {
  const rank = (k: string) => {
    const i = (MODEL_DISPLAY_ORDER as readonly string[]).indexOf(k);
    return i === -1 ? MODEL_DISPLAY_ORDER.length : i;
  };
  return rank(a.model_key) - rank(b.model_key) || a.model_key.localeCompare(b.model_key);
}

/** JSONB 컬럼은 null 이거나 형태가 어긋날 수 있으므로 배열이 아니면 버린다. */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** metrics 안의 `[{market, models:[...]}]` 형태를 market → 배열 맵으로 편다. */
function byMarket<T>(value: unknown, field = 'models'): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const block of asArray<Record<string, unknown>>(value)) {
    const market = typeof block.market === 'string' ? block.market : null;
    if (!market) continue;
    out.set(market, asArray<T>(block[field]));
  }
  return out;
}

/**
 * Cox 재고일수·NHTSA 는 **미국 기준**이다. 인도·한국·중국·유럽 탭에 붙이면 그 시장 수치로
 * 오해되므로 미국(USA)과 글로벌(GLOBAL) 시장에만 붙인다.
 *
 * 🔴 대상 차종뿐 아니라 **경쟁 차종에도** 적용해야 한다. 셀토스 한국 경쟁군의 Kona·Trailblazer
 * 는 `oem_model_brand` 에 매핑이 있어(미국에서도 팔린다) 수집기가 한국 시장 블록에 미국 재고를
 * 담는다 — 실측으로 확인된 오염이다. 수집기는 시장을 모르므로 여기서 거른다.
 */
const US_BASED_MARKETS = new Set(['USA', 'GLOBAL']);

/** cox_brand_inventory 한 행. `days_supply=null` + `is_outlier_excluded` 조합이 핵심 신호다. */
export type CoxRow = {
  brand: string;
  year_month: number;
  days_supply: number | null;
  is_outlier_excluded: boolean | null;
};

/** 브랜드 하나의 재고 상태 — 최근 공개값 2개와 이상치 제외 여부. */
export interface BrandInventoryState {
  current: { yearMonth: number; daysSupply: number } | null;
  previous: { yearMonth: number; daysSupply: number } | null;
  outlierExcluded: boolean;
  outlierMonth: number | null;
}

/**
 * 브랜드별 재고 상태 표.
 *
 * 이상치 판정은 **Cox 전체의 최신 집계월** 기준이다. 브랜드 자신의 마지막 행으로 판정하면, 그 달에
 * 로스터에서 통째로 빠진 브랜드(Lincoln 202601 등)까지 "이상치"로 몰아 없는 사실을 만든다.
 */
export function buildBrandInventory(rows: CoxRow[]): Map<string, BrandInventoryState> {
  const out = new Map<string, BrandInventoryState>();
  if (rows.length === 0) return out;
  const latestMonth = Math.max(...rows.map((r) => r.year_month));

  const byBrand = new Map<string, CoxRow[]>();
  for (const r of rows) {
    const list = byBrand.get(r.brand);
    if (list) list.push(r);
    else byBrand.set(r.brand, [r]);
  }

  for (const [brand, list] of byBrand) {
    const desc = [...list].sort((a, b) => b.year_month - a.year_month);
    const withValue = desc.filter(
      (r): r is CoxRow & { days_supply: number } => typeof r.days_supply === 'number'
    );

    // 최신월부터 연속으로 제외된 구간의 **시작월**. 중간에 값이 있으면 거기서 멈춘다.
    let outlierMonth: number | null = null;
    if (desc[0]?.year_month === latestMonth) {
      for (const r of desc) {
        if (!r.is_outlier_excluded) break;
        outlierMonth = r.year_month;
      }
    }

    out.set(brand, {
      current: withValue[0]
        ? { yearMonth: withValue[0].year_month, daysSupply: withValue[0].days_supply }
        : null,
      previous: withValue[1]
        ? { yearMonth: withValue[1].year_month, daysSupply: withValue[1].days_supply }
        : null,
      outlierExcluded: outlierMonth !== null,
      outlierMonth,
    });
  }
  return out;
}

/**
 * 저장된 재고 스냅샷에 Cox 원본의 최신 상태를 덧씌운다.
 *
 * 경쟁 분석 수집은 월 1회지만 Cox 는 매월 갱신되므로, 원본을 직접 보면 이상치 제외 신호와 전월 대비
 * 증감을 재수집 없이 바로 반영할 수 있다. 브랜드 매핑만 저장값에서 가져온다.
 */
function withCoxState(
  base: { brand: string; days_supply: number | null; year_month: number; model?: string },
  cox: Map<string, BrandInventoryState>
): InventoryPoint {
  const st = cox.get(base.brand);
  // 필드를 골라 쓴다 — 수집기가 실은 snake_case 키(outlier_excluded 등)를 그대로 퍼뜨리면
  // 같은 뜻의 필드가 두 벌로 RSC 페이로드에 실린다.
  return {
    ...(base.model ? { model: base.model } : {}),
    brand: base.brand,
    days_supply: st?.current?.daysSupply ?? base.days_supply,
    year_month: st?.current?.yearMonth ?? base.year_month,
    prevDaysSupply: st?.previous?.daysSupply ?? null,
    prevYearMonth: st?.previous?.yearMonth ?? null,
    outlierExcluded: st?.outlierExcluded ?? false,
    outlierMonth: st?.outlierMonth ?? null,
  };
}

export function mapOutlookRow(
  row: OutlookRow,
  monthly: MonthlyRow[] = [],
  cox: Map<string, BrandInventoryState> = new Map(),
  coxSeries: Map<string, CoxRow[]> = new Map()
): CompetitionOutlook {
  const metrics = asRecord(row.metrics);
  const breakdown = asArray<MarketBreakdown>(row.market_breakdown);

  // metrics.markets 는 경쟁표·세그먼트 주석을, market_breakdown 은 집계·코멘트를 갖는다.
  const detail = new Map<string, Record<string, unknown>>();
  for (const m of asArray<Record<string, unknown>>(metrics.markets)) {
    if (typeof m.market === 'string') detail.set(m.market, m);
  }

  const rivalInv = byMarket<InventoryPoint>(metrics.competitor_inventory);
  const rivalSaf = byMarket<{
    model: string;
    model_year: number;
    recall_count: number;
    complaint_count: number | null;
  }>(metrics.competitor_safety);
  const scores = byMarket<ConsumerScore>(metrics.consumer_scores, 'scores');

  const targetInv = asRecord(metrics.inventory);
  const targetSaf = asRecord(metrics.safety);

  const seriesByMarket = new Map<string, MonthlyRow[]>();
  for (const r of monthly) {
    const list = seriesByMarket.get(r.market);
    if (list) list.push(r);
    else seriesByMarket.set(r.market, [r]);
  }

  const markets: CompetitionMarket[] = breakdown.map((b) => {
    const d = detail.get(b.market) ?? {};
    const competitors = asArray<CompetitorSales>(d.competitors);
    const usBased = US_BASED_MARKETS.has(b.market);

    const inventory: InventoryPoint[] = [];
    const safety: SafetyPoint[] = [];
    if (usBased) {
      if (typeof targetInv.days_supply === 'number') {
        inventory.push(
          withCoxState(
            {
              brand: String(targetInv.brand ?? ''),
              days_supply: targetInv.days_supply,
              year_month: Number(targetInv.year_month ?? 0),
            },
            cox
          )
        );
      }
      inventory.push(...(rivalInv.get(b.market) ?? []).map((p) => withCoxState(p, cox)));

      const targetRecalls = asRecord(targetSaf.recalls);
      if (typeof targetRecalls.count === 'number') {
        safety.push({
          model_year: Number(targetSaf.model_year ?? 0),
          recall_count: targetRecalls.count,
          complaint_count:
            typeof targetSaf.complaint_count === 'number' ? targetSaf.complaint_count : null,
          // 상세는 대상 차종만 수집한다(경쟁 차종까지 받으면 NHTSA 호출 수가 폭증한다).
          recallComponents: asArray<ComponentCount>(targetRecalls.top_components),
          recallSummaries: asArray<string>(targetRecalls.latest),
          // 수집기 확장(2026-08-14) 이전 적재분에는 없다 — 빈 배열이면 화면이 안내로 대체한다.
          complaintComponents: asArray<ComponentCount>(targetSaf.complaint_components),
        });
      }
      safety.push(
        ...(rivalSaf.get(b.market) ?? []).map((s) => ({
          model: s.model,
          model_year: s.model_year,
          recall_count: s.recall_count,
          complaint_count: s.complaint_count,
        }))
      );
    }

    const marketRows = seriesByMarket.get(b.market) ?? [];

    return {
      market: b.market,
      label: b.label,
      comment: b.comment ?? '',
      anchorMonth: b.anchor_month ?? null,
      months: b.months ?? null,
      sales: b.sales,
      yoyPct: b.yoy_pct,
      sharePct: b.share_pct,
      prevSharePct: b.prev_share_pct,
      segmentNote: typeof d.segment_note === 'string' ? d.segment_note : null,
      competitors,
      inventory,
      safety,
      consumerScores: scores.get(b.market) ?? [],
      series: buildSeries(marketRows, competitors),
      shareTrend: buildShareTrend(marketRows, competitors),
      inventoryTrend: buildInventoryTrend(inventory, coxSeries),
      periods: buildPeriods(marketRows),
      // 미국 시장이면 그 시장의 사실, 글로벌이면 미국 참고치(판정 제외). 데이터가 없으면 null.
      usMetricsBasis:
        inventory.length === 0 && safety.length === 0
          ? null
          : b.market === 'USA'
            ? 'native'
            : 'reference',
    };
  });

  return {
    modelKey: row.model_key,
    modelName: row.model_name,
    oemGroup: row.oem_group,
    noteDate: row.note_date,
    label: row.label as CompetitionOutlook['label'],
    salesTrend: row.sales_trend,
    competitiveView: row.competitive_view,
    consumerView: row.consumer_view,
    outlook: row.outlook,
    rationale: row.rationale,
    markets,
    // 적재분에는 프롬프트용 snippet(최대 700자 × 12건)이 섞여 있다. 화면은 title/url/date 만
    // 쓰므로 여기서 잘라내지 않으면 차종당 약 8KB 가 RSC 페이로드·캐시에 그대로 실린다.
    sources: asArray<OutlookSource & { snippet?: string }>(row.sources).map(
      ({ title, url, date }) => ({ title, url, date })
    ),
  };
}

/** 판매 추이에 실을 상위 경쟁 차종 수. 라인이 더 많으면 겹쳐서 읽히지 않는다. */
export const TREND_RIVALS = 3;

/** 추이 차트에 그릴 개월 수. 뷰는 YoY 계산 여유분까지 약 36개월을 갖고 있다. */
export const TREND_MONTHS = 24;

/**
 * 대상 + 판매 상위 경쟁 3종만 월별 시계열로 남긴다.
 * 경쟁군 전체(최대 8종)를 그대로 실으면 RSC 페이로드가 커지고 차트도 읽히지 않는다.
 */
export function buildSeries(rows: MonthlyRow[], competitors: CompetitorSales[]): ModelSeries[] {
  if (rows.length === 0) return [];
  const cutoff = cutoffMonth(Math.max(...rows.map((r) => r.year_month)), TREND_MONTHS);
  const keep = new Set(competitors.slice(0, TREND_RIVALS).map((c) => c.model));

  // 툴팁 YoY 는 12개월 전 실적이 있어야 낸다 → cutoff 로 자르기 **전에** 전 기간을 월 맵으로 잡고,
  // 표시 구간만 뒤에서 잘라낸다. 먼저 자르면 첫 12개월의 YoY 가 통째로 사라진다.
  const grouped = new Map<
    string,
    { model: string; isTarget: boolean; byMonth: Map<number, number> }
  >();
  for (const r of rows) {
    if (!r.is_target && !keep.has(r.model)) continue;
    const key = r.is_target ? `__target__${r.model}` : r.model;
    let s = grouped.get(key);
    if (!s) {
      s = { model: r.model, isTarget: r.is_target, byMonth: new Map() };
      grouped.set(key, s);
    }
    s.byMonth.set(r.year_month, (s.byMonth.get(r.year_month) ?? 0) + r.sales);
  }

  const out: ModelSeries[] = [...grouped.values()].map((s) => ({
    model: s.model,
    isTarget: s.isTarget,
    points: [...s.byMonth.entries()]
      .filter(([ym]) => ym >= cutoff)
      .sort((a, b) => a[0] - b[0])
      .map(([ym, sales]) => {
        const base = s.byMonth.get(addMonths(ym, -12));
        // base 가 0 이면 나눗셈이 Infinity 가 된다 — 증감률을 낼 수 없는 경우로 함께 묶는다.
        return {
          yearMonth: ym,
          sales,
          yoyPct: base ? round1(((sales - base) * 100) / base) : null,
        };
      }),
  }));

  // 대상 차종이 먼저(차트 범례·색 배정 기준), 그다음 경쟁은 competitors 순서(=판매 내림차순)
  const order = (s: ModelSeries) =>
    s.isTarget ? -1 : competitors.findIndex((c) => c.model === s.model);
  return out.sort((a, b) => order(a) - order(b));
}

/**
 * 경쟁군 내 점유율의 **12개월 이동 누계** 추이.
 *
 * 왜 이동 누계인가: 단월 점유율은 경쟁차 한 종이 그달 실적을 아직 안 올리면 분모가 줄어 대상이
 * 가짜로 치솟는다(MarkLines 도착 시점이 차종마다 다르다). 12개월 창은 그 결측을 흡수하고, 계절성도
 * 없애며, KPI·스코어보드가 쓰는 L12M 정의와 **같은 값**이라 끝점이 KPI 와 맞아떨어진다.
 *
 * 분모는 대상 + **경쟁군 전체**다(라인으로 그리는 상위 3종만이 아니다) — 그래야 화면 다른 곳의
 * 점유율과 같은 모집단이 된다.
 */
export function buildShareTrend(
  rows: MonthlyRow[],
  competitors: CompetitorSales[]
): ModelShareTrend[] {
  if (rows.length === 0) return [];
  const latest = Math.max(...rows.map((r) => r.year_month));
  const cutoff = cutoffMonth(latest, TREND_MONTHS);

  // 모델별 월 판매 + 월별 경쟁군 전체 합계를 한 번에 만든다.
  const byModel = new Map<
    string,
    { model: string; isTarget: boolean; byMonth: Map<number, number> }
  >();
  const totalByMonth = new Map<number, number>();
  for (const r of rows) {
    const key = r.is_target ? TARGET_BUCKET : r.model;
    let s = byModel.get(key);
    if (!s) {
      s = { model: r.model, isTarget: r.is_target, byMonth: new Map() };
      byModel.set(key, s);
    }
    s.byMonth.set(r.year_month, (s.byMonth.get(r.year_month) ?? 0) + r.sales);
    totalByMonth.set(r.year_month, (totalByMonth.get(r.year_month) ?? 0) + r.sales);
  }

  /**
   * ym 에서 뒤로 12개월 누계. **없는 달은 0 으로 센다.**
   *
   * 🔴 처음에는 창 안에 빈 달이 하나라도 있으면 null 을 냈는데, 그러면 **모든 선이 통째로 비었다**
   * (2026-08-14 화면 확인). 경쟁 차종은 안 팔린 달에 아예 행이 없어서 12개월 연속인 차종이 거의
   * 없기 때문이다. 그 달의 판매는 실제로 0 이므로 0 으로 세는 편이 사실에 맞다.
   * "창이 덜 찼다"는 판정은 아래 `windowComplete` 가 **데이터 시작월**로 따로 한다.
   */
  const sumWindow = (byMonth: Map<number, number>, ym: number): number => {
    let sum = 0;
    for (let i = 0; i < 12; i += 1) sum += byMonth.get(addMonths(ym, -i)) ?? 0;
    return sum;
  };

  const minMonth = Math.min(...totalByMonth.keys());
  /** 창의 첫 달이 데이터 시작 이전이면 누계가 덜 찬 것 — 그 구간은 값을 내지 않는다. */
  const windowComplete = (ym: number) => addMonths(ym, -11) >= minMonth;

  const months = [...totalByMonth.keys()].filter((ym) => ym >= cutoff).sort((a, b) => a - b);
  const keep = new Set(competitors.slice(0, TREND_RIVALS).map((c) => c.model));

  const out: ModelShareTrend[] = [];
  for (const [key, s] of byModel) {
    if (key !== TARGET_BUCKET && !keep.has(s.model)) continue;
    out.push({
      model: s.model,
      isTarget: s.isTarget,
      points: months.map((ym) => {
        if (!windowComplete(ym)) return { yearMonth: ym, sharePct: null };
        const den = sumWindow(totalByMonth, ym);
        return {
          yearMonth: ym,
          sharePct: den > 0 ? round1((sumWindow(s.byMonth, ym) * 100) / den) : null,
        };
      }),
    });
  }

  const order = (s: ModelShareTrend) =>
    s.isTarget ? -1 : competitors.findIndex((c) => c.model === s.model);
  return out.sort((a, b) => order(a) - order(b));
}

/**
 * 브랜드 재고일수 추이 — 화면에 이미 붙은 `inventory`(대상+경쟁)의 브랜드만 Cox 원본에서 뽑는다.
 *
 * `days_supply=null` 행을 버리지 않는 이유: 그 달은 **평균 2배 초과로 값이 감춰진** 달일 수 있고,
 * 그 사실 자체가 가장 중요한 신호다. 값은 null 로 두고 플래그를 함께 넘겨 화면이 구간을 표시한다.
 */
export function buildInventoryTrend(
  inventory: InventoryPoint[],
  coxByBrand: Map<string, CoxRow[]>
): BrandInventoryTrend[] {
  const out: BrandInventoryTrend[] = [];
  const seen = new Set<string>();
  for (const inv of inventory) {
    if (!inv.brand || seen.has(inv.brand)) continue;
    seen.add(inv.brand);
    const rows = coxByBrand.get(inv.brand);
    if (!rows || rows.length === 0) continue;
    out.push({
      brand: inv.brand,
      ...(inv.model ? { model: inv.model } : {}),
      // `inventory[0]` 이 대상이라는 규칙에 기대지 않는다 — model 이 없는 쪽이 대상이다.
      isTarget: !inv.model,
      points: rows.map((r) => ({
        yearMonth: r.year_month,
        daysSupply: r.days_supply,
        outlierExcluded: r.is_outlier_excluded === true,
      })),
    });
  }
  return out;
}

/** 브랜드별 Cox 원본(월 오름차순). 추이 차트가 쓰는 형태. */
export function buildCoxSeries(rows: CoxRow[]): Map<string, CoxRow[]> {
  const out = new Map<string, CoxRow[]>();
  for (const r of rows) {
    const list = out.get(r.brand);
    if (list) list.push(r);
    else out.set(r.brand, [r]);
  }
  for (const list of out.values()) list.sort((a, b) => a.year_month - b.year_month);
  return out;
}

/** YYYYMM 에 delta 개월을 더한 YYYYMM(음수면 과거). 예: (202601, -12) → 202501 */
export function addMonths(ym: number, delta: number): number {
  const total = Math.floor(ym / 100) * 12 + ((ym % 100) - 1) + delta;
  return Math.floor(total / 12) * 100 + (total % 12) + 1;
}

/** YYYYMM 에서 months 개월 전(포함)의 YYYYMM. 예: (202607, 24) → 202408 */
export function cutoffMonth(latest: number, months: number): number {
  return addMonths(latest, -(months - 1));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 대상 표기가 여러 개인 차종(아반떼 중국의 2개 모델명)을 한 줄로 합치기 위한 버킷 키. */
const TARGET_BUCKET = ' target';

/** 기준별 집계 창(start~end, 둘 다 포함). offsetYears=1 이면 전년 동기. */
export function periodWindow(
  basis: PeriodBasis,
  anchor: number,
  offsetYears = 0
): { start: number; end: number } {
  const end = anchor - offsetYears * 100;
  // YTD 는 그 해 1월부터라 창 길이가 달마다 다르다(6월 기준이면 6개월). L12M 은 항상 12개월.
  const start = basis === 'YTD' ? Math.floor(end / 100) * 100 + 1 : addMonths(end, -11);
  return { start, end };
}

function periodLabelFor(basis: PeriodBasis, anchor: number): string {
  if (basis === 'L12M') return '최근 12개월';
  const year = Math.floor(anchor / 100);
  return `${year}년 누계(1~${anchor % 100}월)`;
}

/**
 * 월별 뷰에서 기준 2종(최근 12개월 · YTD)을 재집계한다.
 *
 * 🔴 앵커월은 대상·경쟁군의 **최신월 중 이른 쪽**이다 — 수집기 `compute_market_metrics` 와 같은
 * 규칙이어야 L12M 결과가 저장값(market_breakdown)과 일치한다. 각자의 최신월을 쓰면 대상만 한 달
 * 더 담겨 점유율이 조용히 부풀려진다.
 */
export function buildPeriods(rows: MonthlyRow[]): PeriodAggregate[] {
  if (rows.length === 0) return [];
  const targetLatest = Math.max(0, ...rows.filter((r) => r.is_target).map((r) => r.year_month));
  const rivalLatest = Math.max(0, ...rows.filter((r) => !r.is_target).map((r) => r.year_month));
  const anchor =
    targetLatest && rivalLatest ? Math.min(targetLatest, rivalLatest) : targetLatest || rivalLatest;
  if (!anchor) return [];

  return (['L12M', 'YTD'] as const)
    .map((basis) => aggregatePeriod(rows, basis, anchor))
    .filter((p): p is PeriodAggregate => p !== null);
}

function aggregatePeriod(
  rows: MonthlyRow[],
  basis: PeriodBasis,
  anchor: number
): PeriodAggregate | null {
  const cur = periodWindow(basis, anchor);
  const prev = periodWindow(basis, anchor, 1);

  const bucket = new Map<string, { model: string; isTarget: boolean; s: number; p: number }>();
  for (const r of rows) {
    const key = r.is_target ? TARGET_BUCKET : r.model;
    let b = bucket.get(key);
    if (!b) {
      b = { model: r.model, isTarget: r.is_target, s: 0, p: 0 };
      bucket.set(key, b);
    }
    if (r.year_month >= cur.start && r.year_month <= cur.end) b.s += r.sales;
    else if (r.year_month >= prev.start && r.year_month <= prev.end) b.p += r.sales;
  }

  const entries = [...bucket.values()];
  const totalSales = entries.reduce((acc, b) => acc + b.s, 0);
  const prevTotalSales = entries.reduce((acc, b) => acc + b.p, 0);
  if (totalSales <= 0) return null;

  const models: PeriodModelSales[] = entries
    .map((b) => ({
      model: b.model,
      isTarget: b.isTarget,
      sales: b.s,
      prevSales: b.p,
      yoyPct: b.p > 0 ? round1(((b.s - b.p) * 100) / b.p) : null,
      sharePct: round1((b.s * 100) / totalSales),
      // 전년 창에 경쟁군 실적이 아예 없으면 점유율의 분모가 없다 — 0% 라고 단정하지 않는다.
      prevSharePct: prevTotalSales > 0 ? round1((b.p * 100) / prevTotalSales) : null,
    }))
    .sort((a, b) => b.sales - a.sales);

  return {
    basis,
    label: periodLabelFor(basis, anchor),
    anchorMonth: anchor,
    months: basis === 'YTD' ? anchor % 100 : 12,
    models,
    totalSales,
    prevTotalSales,
  };
}

/** 차종별 최신 1건만 남긴다(테이블 PK 가 (model_key, note_date) 라 이력이 쌓인다). */
export function pickLatestPerModel<T extends { model_key: string; note_date: string }>(
  rows: T[]
): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const prev = latest.get(row.model_key);
    if (!prev || row.note_date > prev.note_date) latest.set(row.model_key, row);
  }
  return [...latest.values()];
}

/**
 * 경쟁군 월별 판매 시계열(뷰). 원본 테이블 태그를 달아 MarkLines 적재 시 함께 무효화된다.
 * 🔴 `.range()` 페이징에는 `.order()` 가 필수다 — 없으면 페이지 경계에서 행이 누락·중복된다.
 */
async function fetchMonthly(): Promise<MonthlyRow[]> {
  'use cache';
  cacheLife('days');
  cacheTag('oem_sales_model_country_month');

  const supabase = createSupabaseAnonClient();
  const out: MonthlyRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('oem_competition_monthly_view')
      .select('model_key,market,model,is_target,year_month,sales')
      .order('model_key')
      .order('market')
      .order('model')
      .order('year_month')
      .range(from, from + PAGE - 1);
    if (error) {
      logger.error({ err: error }, 'oem_competition_monthly_view 조회 실패');
      return out;
    }
    const rows = (data ?? []) as MonthlyRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  // 0행이면 판매 추이 차트가 **에러 없이 통째로 빈다** — 실제로 그렇게 나갔었다(구체화 뷰 전환
  // 전 statement timeout). 구체화 뷰라 REFRESH 누락으로도 같은 증상이 나므로 흔적을 남긴다.
  if (out.length === 0) {
    logger.warn('oem_competition_monthly_view 0행 — refresh_oem_agg_views() 누락 의심');
  }
  return out;
}

/**
 * Cox 브랜드 재고 원본. 브랜드 30여 개 × 월이라 전량을 받아도 수천 행이다.
 *
 * 경쟁 분석 스냅샷(월 1회)이 아니라 원본을 직접 보는 이유: 이상치 제외(= 재고 심각) 신호와 전월
 * 대비 증감이 스냅샷에는 담기지 않는데, 그 둘이 화면에서 가장 중요한 경고다.
 */
async function fetchCoxInventory(): Promise<CoxRow[]> {
  'use cache';
  cacheLife('days');
  // 🔴 태그는 `scripts/lib/revalidate.py` 의 표기(하이픈)를 그대로 써야 한다 — 테이블명
  // (`cox_brand_inventory`)을 쓰면 수집 후에도 무효화가 조용히 안 걸린다.
  cacheTag('cox-brand-inventory');

  const supabase = createSupabaseAnonClient();
  const { data, error } = await supabase
    .from('cox_brand_inventory')
    .select('brand,year_month,days_supply,is_outlier_excluded')
    .order('year_month', { ascending: false })
    .limit(2000);

  if (error) {
    logger.error({ err: error }, 'cox_brand_inventory 조회 실패');
    return [];
  }
  return (data ?? []) as CoxRow[];
}

/** `/oem/competition` 화면 데이터. 수집기가 revalidate 태그를 쳐서 갱신한다. */
export async function getCompetitionOutlooks(): Promise<CompetitionOutlook[]> {
  'use cache';
  cacheLife('days');
  cacheTag('oem_model_outlook');

  const supabase = createSupabaseAnonClient();
  // `metrics` 는 경쟁표·재고·리콜·소비자 점수의 원본이라 화면이 실제로 쓴다. 다만 200행분을
  // 통째로 받지 않도록 컬럼은 명시하고 최신 1건만 남긴다.
  const { data, error } = await supabase
    .from('oem_model_outlook')
    .select(
      'model_key,model_name,oem_group,region,note_date,label,sales_trend,competitive_view,consumer_view,outlook,rationale,market_breakdown,metrics,sources'
    )
    .order('note_date', { ascending: false })
    .limit(200);

  if (error) {
    logger.error({ err: error }, 'oem_model_outlook 조회 실패');
    return [];
  }

  const latest = pickLatestPerModel((data ?? []) as OutlookRow[]).sort(compareForDisplay);
  const [monthly, coxRows] = await Promise.all([fetchMonthly(), fetchCoxInventory()]);
  const byKey = new Map<string, MonthlyRow[]>();
  for (const r of monthly) {
    const list = byKey.get(r.model_key);
    if (list) list.push(r);
    else byKey.set(r.model_key, [r]);
  }
  const cox = buildBrandInventory(coxRows);
  const coxSeries = buildCoxSeries(coxRows);
  return latest.map((row) => mapOutlookRow(row, byKey.get(row.model_key) ?? [], cox, coxSeries));
}
