/**
 * 손익 계획(/management/plan) 도메인 데이터 입구 — fetch + 'use cache'.
 *
 * - pnl_plan: 사외비 → confidentialDb(service_role).
 * - longterm_revenue_plan: 사외비 → confidentialDb. 중장기 매출 전망(차트 1).
 * - 전사 매출/영업이익 실적(차트 3·4)은 pnl_entries 기반 getPreparedPnl() 재사용.
 * - 미국 차트 원화 환산용 현재 USD/KRW는 exchange_rates_live(공개)에서.
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { confidentialDb } from '@/lib/supabase/confidential';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import { getPreparedPnl } from '@/lib/pnl/source';
import type { PreparedPnlData } from '@/lib/pnl/aggregate';
import type { Basis } from '@/lib/pnl/types';
import type { PlanRow } from './types';
import type { LongtermRow, LongtermSeries } from './longterm';

async function fetchPlanRows(): Promise<PlanRow[]> {
  const { data, error } = await confidentialDb
    .from('pnl_plan')
    .select('*')
    .order('category', { ascending: true })
    .order('item', { ascending: true })
    .order('period_year', { ascending: true })
    .order('period_month', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'pnl_plan 조회 실패');
    throw new Error(`Supabase pnl_plan 조회 실패: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    ...r,
    basis: r.basis as Basis,
    kind: r.kind as PlanRow['kind'],
    period_type: r.period_type as PlanRow['period_type'],
  }));
}

async function fetchLongtermRows(): Promise<LongtermRow[]> {
  const { data, error } = await confidentialDb
    .from('longterm_revenue_plan')
    .select('*')
    .order('basis_year', { ascending: true })
    .order('basis_quarter', { ascending: true })
    .order('series', { ascending: true })
    .order('period_year', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'longterm_revenue_plan 조회 실패');
    throw new Error(`Supabase longterm_revenue_plan 조회 실패: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    ...r,
    series: r.series as LongtermSeries,
  }));
}

export interface PlanData {
  plan: PlanRow[];
  /** 전사 매출/영업이익 실적용 (차트 3·4) */
  prepared: PreparedPnlData;
  /** 현재 USD→KRW (원/USD). 없으면 null */
  usdKrw: number | null;
  /** 중장기 매출 전망 (차트 1) */
  longterm: LongtermRow[];
}

export async function getPlanData(): Promise<PlanData> {
  'use cache';
  cacheLife('days');
  cacheTag('pnl_plan');
  cacheTag('pnl_entries');
  cacheTag('exchange_rates_live');
  cacheTag('longterm_revenue_plan');

  const supabase = createSupabaseAnonClient();
  const [plan, prepared, fx, longterm] = await Promise.all([
    fetchPlanRows(),
    getPreparedPnl(),
    supabase.from('exchange_rates_live').select('base,rate').eq('base', 'USD').maybeSingle(),
    fetchLongtermRows(),
  ]);
  const usdKrw = fx.data?.rate ?? null;
  return { plan, prepared, usdKrw, longterm };
}
