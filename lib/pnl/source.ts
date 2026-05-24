/**
 * 손익(P&L) 도메인 데이터 입구 — fetch + 'use cache' + mapping.
 *
 * 페이지/API 라우트는 본 모듈의 함수만 호출하면 된다. 사외비 클라이언트 선택,
 * 페이지네이션, cache 메타데이터(tag/life), Row → 도메인 타입 narrow는 모두
 * 이 안에 격리되어 있다.
 *
 * 향후 경영관리 하부 페이지(계획·재고·생산 등)도 동일 패턴으로 별도 source.ts
 * (`lib/plan/source.ts`, `lib/inventory/source.ts`, ...)를 만들어 확장한다.
 *
 * AGENTS.md "사외비 테이블 격리" 섹션 참고.
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { confidentialDb } from '@/lib/supabase/confidential';
import { preparePnlData, type PreparedPnlData } from './aggregate';
import type { Basis, CostStructureRow, PnlEntry } from './types';

// PostgREST 기본 max-rows=1000 → range 페이지네이션으로 전체 fetch.
const SUPABASE_PAGE_SIZE = 1000;

/**
 * `pnl_entries` raw fetch — 내부 헬퍼.
 *
 * 외부는 `getPreparedPnl()`만 호출한다. raw 1000+ 행은 RSC payload로 통과시키지
 * 말고 서버에서 가공한 PreparedPnlData만 client에 전달 (RSC payload 1/3 감소).
 *
 * 사외비 — confidentialDb 자동 라우팅으로 service_role 사용.
 */
async function fetchPnlEntries(): Promise<PnlEntry[]> {
  const all: PnlEntry[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await confidentialDb
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
    // Row와 PnlEntry는 basis(string ↔ 'consolidated' | 'standalone')만 다름.
    for (const row of data) {
      all.push({ ...row, basis: row.basis as Basis });
    }
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}

/**
 * 손익 페이지 데이터 — raw fetch + 서버 사전 가공 + 1시간 캐시.
 *
 * - 캐시 무효화: scripts/lib/revalidate.py가 `pnl_entries` 태그 갱신.
 * - `preparePnlData`는 pure 함수 — cache hit 시 prepared 객체가 그대로 반환되어
 *   client useMemo(preparePnlData) 단계가 사라진다 (PnlDashboard hydration ↓).
 */
export async function getPreparedPnl(): Promise<PreparedPnlData> {
  'use cache';
  cacheLife('hours');
  cacheTag('pnl_entries');

  const raw = await fetchPnlEntries();
  return preparePnlData(raw);
}

/**
 * `pnl_cost_structure` 전체 fetch + 1시간 캐시.
 *
 * ≤ 수백 행이라 페이지네이션 불필요.
 */
export async function getCostStructure(): Promise<CostStructureRow[]> {
  'use cache';
  cacheLife('hours');
  cacheTag('pnl_cost_structure');

  const { data, error } = await confidentialDb
    .from('pnl_cost_structure')
    .select('*')
    .order('period_year', { ascending: true })
    .order('period_month', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'pnl_cost_structure 조회 실패');
    throw new Error(`Supabase pnl_cost_structure 조회 실패: ${error.message}`);
  }
  // Row와 CostStructureRow는 period_kind / kind만 narrow union이 필요. 나머지는 동일.
  return (data ?? []).map((row) => ({
    ...row,
    period_kind: row.period_kind as 'annual' | 'monthly',
    kind: row.kind as 'actual' | 'plan',
  }));
}
