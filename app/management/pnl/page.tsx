import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import PnlDashboard from '@/components/management/pnl/PnlDashboard';
import type { Basis, PnlEntry } from '@/lib/pnl/types';

// PostgREST 기본 max-rows=1000. 페이지네이션으로 전체 fetch.
const SUPABASE_PAGE_SIZE = 1000;

/** Supabase pnl_entries 전체 fetch (한 번 select 최대 1000행 → range 페이지네이션) */
async function fetchAllPnlEntries(): Promise<PnlEntry[]> {
  const supabase = createSupabaseAnonClient();
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

/** 손익 페이지 (server) — pnl_entries 전체 select 후 클라이언트에서 집계 */
export default async function PnlPage() {
  const data = await getPnlData();
  return <PnlDashboard data={data} />;
}
