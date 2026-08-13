import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import logger from '@/lib/logger';
import type { CompetitionOutlook, MarketBreakdown, OutlookSource } from './types';

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
  market_breakdown: unknown;
  sources: unknown;
};

/** JSONB 컬럼은 null 이거나 형태가 어긋날 수 있으므로 배열이 아니면 버린다. */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function mapOutlookRow(row: OutlookRow): CompetitionOutlook {
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
    markets: asArray<MarketBreakdown>(row.market_breakdown),
    // 적재분에는 프롬프트용 snippet(최대 700자 × 12건)이 섞여 있다. 화면은 title/url/date 만
    // 쓰므로 여기서 잘라내지 않으면 차종당 약 8KB 가 RSC 페이로드·캐시에 그대로 실린다.
    sources: asArray<OutlookSource & { snippet?: string }>(row.sources).map(
      ({ title, url, date }) => ({ title, url, date })
    ),
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

/** `/oem/competition` 카드 데이터. 수집기가 revalidate 태그를 쳐서 갱신한다. */
export async function getCompetitionOutlooks(): Promise<CompetitionOutlook[]> {
  'use cache';
  cacheLife('days');
  cacheTag('oem_model_outlook');

  const supabase = createSupabaseAnonClient();
  // `metrics`(경쟁군 표·NHTSA·Cox 원본)는 감사용이라 화면이 쓰지 않는다. `select('*')` 로
  // 끌어오면 200행분 blob 을 받아 10행만 남기고 버리게 되므로 컬럼을 명시한다.
  const { data, error } = await supabase
    .from('oem_model_outlook')
    .select(
      'model_key,model_name,oem_group,note_date,label,sales_trend,competitive_view,consumer_view,outlook,rationale,market_breakdown,sources'
    )
    .order('note_date', { ascending: false })
    .limit(200);

  if (error) {
    logger.error({ err: error }, 'oem_model_outlook 조회 실패');
    return [];
  }
  return pickLatestPerModel((data ?? []) as OutlookRow[]).map(mapOutlookRow);
}
