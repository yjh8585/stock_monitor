import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import logger from '@/lib/logger';
import type {
  CompetitionMarket,
  CompetitionOutlook,
  CompetitorSales,
  ConsumerScore,
  InventoryPoint,
  MarketBreakdown,
  ModelSeries,
  OutlookSource,
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

export function mapOutlookRow(row: OutlookRow, monthly: MonthlyRow[] = []): CompetitionOutlook {
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
        inventory.push({
          brand: String(targetInv.brand ?? ''),
          days_supply: targetInv.days_supply,
          year_month: Number(targetInv.year_month ?? 0),
        });
      }
      inventory.push(...(rivalInv.get(b.market) ?? []));

      const targetRecalls = asRecord(targetSaf.recalls);
      if (typeof targetRecalls.count === 'number') {
        safety.push({
          model_year: Number(targetSaf.model_year ?? 0),
          recall_count: targetRecalls.count,
          complaint_count:
            typeof targetSaf.complaint_count === 'number' ? targetSaf.complaint_count : null,
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
      series: buildSeries(seriesByMarket.get(b.market) ?? [], competitors),
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

  const grouped = new Map<string, ModelSeries>();
  for (const r of rows) {
    if (r.year_month < cutoff) continue;
    if (!r.is_target && !keep.has(r.model)) continue;
    const key = r.is_target ? `__target__${r.model}` : r.model;
    let s = grouped.get(key);
    if (!s) {
      s = { model: r.model, isTarget: r.is_target, points: [] };
      grouped.set(key, s);
    }
    s.points.push({ yearMonth: r.year_month, sales: r.sales });
  }
  for (const s of grouped.values()) s.points.sort((a, b) => a.yearMonth - b.yearMonth);

  // 대상 차종이 먼저(차트 범례·색 배정 기준), 그다음 경쟁은 competitors 순서(=판매 내림차순)
  const order = (s: ModelSeries) =>
    s.isTarget ? -1 : competitors.findIndex((c) => c.model === s.model);
  return [...grouped.values()].sort((a, b) => order(a) - order(b));
}

/** YYYYMM 에서 months 개월 전(포함)의 YYYYMM. 예: (202607, 24) → 202408 */
export function cutoffMonth(latest: number, months: number): number {
  const y = Math.floor(latest / 100);
  const m = latest % 100;
  const total = y * 12 + (m - 1) - (months - 1);
  return Math.floor(total / 12) * 100 + (total % 12) + 1;
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
  const monthly = await fetchMonthly();
  const byKey = new Map<string, MonthlyRow[]>();
  for (const r of monthly) {
    const list = byKey.get(r.model_key);
    if (list) list.push(r);
    else byKey.set(r.model_key, [r]);
  }
  return latest.map((row) => mapOutlookRow(row, byKey.get(row.model_key) ?? []));
}
