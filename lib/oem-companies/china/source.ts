/**
 * 중국 탭(/oem/china) 데이터 입구 — fetch + 'use cache' + 사전 가공.
 *
 * 원천 = MarkLines 중국 전용 엑셀 3종(scripts/sync_oem_china_excel.py 가 주 1회 적재).
 * 원본 행(생산 약 6만)은 이 함수 안에서만 쓰고 **기존 차트가 받는 모양으로 줄인 결과만 반환**한다 — 원본을
 * 캐시에 실으면 페이로드가 MB 단위가 되어 ISR Write 를 낭비한다(docs/isr-write-optimization.md).
 * 순위용 (묶음, 월) 행은 차트가 읽는 해부터만 싣는다(aggregate.ts `groupMonthRows`).
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { fetchAll } from '@/lib/oem/source';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import {
  buildExportGroupMonth,
  buildExportTagMix,
  buildExportTopModels,
  buildFlows,
  buildKpi,
  buildProductionGroupMonth,
  buildProductionTopModels,
  buildPtMix,
  buildTypeSegMonth,
  minYm,
  periodsOf,
} from './aggregate';

/** 데이터가 없으면 null — 페이지가 「수집 대기」 안내를 띄운다 */
export async function getChinaData() {
  'use cache';
  // 주 1회 갱신 데이터 — 기본 15분이면 쓸데없이 재생성된다(AGENTS.md lib/oem-competition 약속과 같은 이유)
  cacheLife('days');
  cacheTag('oem_china_production_month');
  cacheTag('oem_china_segment_month');
  cacheTag('oem_china_export_month');

  const supabase = createSupabaseAnonClient();
  const [prod, exp, seg] = await Promise.all([
    fetchAll(supabase, 'oem_china_production_month', [
      'cn_group',
      'maker_brand',
      'vehicle_type',
      'model',
      'powertrain',
      'year_month',
    ]),
    fetchAll(supabase, 'oem_china_export_month', [
      'cn_group',
      'maker',
      'brand',
      'model',
      'year_month',
    ]),
    fetchAll(supabase, 'oem_china_segment_month', ['vehicle_type', 'segment', 'year_month']),
  ]);

  const periods = periodsOf(prod, exp);
  if (!periods) return null;

  return {
    periods,
    /** 생산 이력 시작월 — 머리글 「YYYY.MM~」 */
    firstYm: minYm(prod),
    kpi: buildKpi(prod, periods),
    flows: buildFlows(prod, exp, periods),
    ptMix: buildPtMix(prod, periods),
    productionGroupMonth: buildProductionGroupMonth(prod, periods),
    typeSegMonth: buildTypeSegMonth(seg, periods),
    productionTopModels: buildProductionTopModels(prod, periods),
    exportGroupMonth: buildExportGroupMonth(exp, periods),
    exportTopModels: buildExportTopModels(exp, periods),
    exportTagMix: buildExportTagMix(exp, periods),
  };
}

export type ChinaData = NonNullable<Awaited<ReturnType<typeof getChinaData>>>;
