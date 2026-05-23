import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import PnlDashboard from '@/components/management/pnl/PnlDashboard';
import type { Basis, CostStructureRow, PnlEntry } from '@/lib/pnl/types';

// PostgREST 기본 max-rows=1000. 페이지네이션으로 전체 fetch.
const SUPABASE_PAGE_SIZE = 1000;

// pnl_entries / pnl_cost_structure 는 RLS로 anon 접근 차단됨 (migration 20260523000002).
// service_role(admin client)만 SELECT 가능 — 사외비 데이터 외부 추출 방지.

/** Supabase pnl_entries 전체 fetch (한 번 select 최대 1000행 → range 페이지네이션) */
async function fetchAllPnlEntries(): Promise<PnlEntry[]> {
  const supabase = createSupabaseAdminClient();
  const all: PnlEntry[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('pnl_entries')
      .select('*')
      .order('basis', { ascending: true })
      .order('period_year', { ascending: true })
      .order('period_month', { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) {
      logger.error({ err: error }, 'pnl_entries 조회 실패');
      throw new Error(`Supabase pnl_entries 조회 실패: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    // database.types.ts에 아직 미반영(Auto-gen 대기) — 명시적 매핑으로 PnlEntry 타입 만족
    for (const row of data) {
      const r = row as Record<string, unknown>;
      all.push({
        basis: r.basis as Basis,
        year_label: String(r.year_label ?? ''),
        period_year: Number(r.period_year ?? 0),
        period_month: Number(r.period_month ?? 0),
        is_plan: Boolean(r.is_plan),
        is_estimate: Boolean(r.is_estimate),
        sil: String(r.sil ?? ''),
        division: String(r.division ?? ''),
        factory: String(r.factory ?? ''),
        product: String(r.product ?? ''),
        customer: String(r.customer ?? ''),
        revenue: r.revenue == null ? null : Number(r.revenue),
        material_cost: r.material_cost == null ? null : Number(r.material_cost),
        labor_cost: r.labor_cost == null ? null : Number(r.labor_cost),
        expense: r.expense == null ? null : Number(r.expense),
        sga: r.sga == null ? null : Number(r.sga),
        rnd: r.rnd == null ? null : Number(r.rnd),
        op_income: r.op_income == null ? null : Number(r.op_income),
      });
    }
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}

/** Cache Components: pnl_entries fetch — 1시간 단위 캐시 */
async function getPnlData() {
  'use cache';
  cacheLife('hours');
  cacheTag('pnl_entries');
  return fetchAllPnlEntries();
}

/** Supabase pnl_cost_structure 전체 fetch (≤ 수백 행이라 페이지네이션 불필요) */
async function fetchAllCostStructure(): Promise<CostStructureRow[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('pnl_cost_structure')
    .select('*')
    .order('period_year', { ascending: true })
    .order('period_month', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'pnl_cost_structure 조회 실패');
    throw new Error(`Supabase pnl_cost_structure 조회 실패: ${error.message}`);
  }
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      period_year: Number(r.period_year ?? 0),
      period_kind: (r.period_kind as 'annual' | 'monthly') ?? 'annual',
      period_month: Number(r.period_month ?? 0),
      kind: (r.kind as 'actual' | 'plan') ?? 'actual',
      category: String(r.category ?? ''),
      account: String(r.account ?? ''),
      value_mwon: r.value_mwon == null ? null : Number(r.value_mwon),
    };
  });
}

async function getCostStructureData() {
  'use cache';
  cacheLife('hours');
  cacheTag('pnl_cost_structure');
  return fetchAllCostStructure();
}

/** 손익 페이지 (server) — pnl_entries 전체 select 후 클라이언트에서 집계 */
export default async function PnlPage() {
  const [data, costStructure] = await Promise.all([getPnlData(), getCostStructureData()]);
  return <PnlDashboard data={data} costStructure={costStructure} />;
}
