/**
 * 손익 계획(/management/plan) 도메인 데이터 입구 — fetch + 'use cache'.
 *
 * - pnl_plan: 사외비 → confidentialDb(service_role).
 * - 전사 매출/영업이익 실적(차트 2·3)은 pnl_entries 기반 getPreparedPnl() 재사용.
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

export interface PlanData {
  plan: PlanRow[];
  /** 전사 매출/영업이익 실적용 (차트 2·3) */
  prepared: PreparedPnlData;
  /** 현재 USD→KRW (원/USD). 없으면 null */
  usdKrw: number | null;
}

export async function getPlanData(): Promise<PlanData> {
  'use cache';
  cacheLife('hours');
  cacheTag('pnl_plan');
  cacheTag('pnl_entries');
  cacheTag('exchange_rates_live');

  const supabase = createSupabaseAnonClient();
  const [plan, prepared, fx] = await Promise.all([
    fetchPlanRows(),
    getPreparedPnl(),
    supabase.from('exchange_rates_live').select('base,rate').eq('base', 'USD').maybeSingle(),
  ]);
  const usdKrw = fx.data?.rate ?? null;
  return { plan, prepared, usdKrw };
}
