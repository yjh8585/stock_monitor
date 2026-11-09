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
import type { Basis, CostStructureRow, FixedVariableRow, PnlEntry } from './types';

// PostgREST 기본 max-rows=1000 → range 페이지네이션으로 전체 fetch.
const SUPABASE_PAGE_SIZE = 1000;

/**
 * `pnl_entries` raw fetch — 내부 헬퍼.
 *
 * 외부는 `getPreparedPnl()`만 호출한다. raw 1000+ 행은 RSC payload로 통과시키지
 * 말고 서버에서 가공한 PreparedPnlData만 client에 전달 (RSC payload 1/3 감소).
 * 예외: 고객사 매출 비중(`lib/customers/source.ts`)이 raw 를 서버에서만 집계한다 — 결과(비중)만 화면에 넘긴다.
 *
 * 사외비 — confidentialDb 자동 라우팅으로 service_role 사용.
 */
export async function fetchPnlEntries(): Promise<PnlEntry[]> {
  const all: PnlEntry[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await confidentialDb
      .from('pnl_entries')
      .select('*')
      .order('basis', { ascending: true })
      .order('period_year', { ascending: true })
      // PK 는 period_year 가 아니라 year_label 이다 — '2025'·'2025(E)' 처럼 같은 연도에 라벨이 둘이면 동률이 되므로
      // 정렬에 넣는다. 그래서 같은 period_year 안에서는 라벨 단위로 묶여 나온다('2025' 전체 → '2025(E)' 전체).
      // 소비처(preparePnlData 등)는 거르고 더하기만 해 행 순서가 결과를 바꾸지 않는다.
      .order('year_label', { ascending: true })
      .order('period_month', { ascending: true })
      // 같은 (basis, 연, 월) 안에서도 sil·division·factory·product·customer 5차원으로
      // 행이 갈린다 — 여기까지 정렬하지 않으면 동률이 페이지 경계에서 흔들려 행이
      // 누락·중복된다(PK 8컬럼 basis·year_label·period_month·sil·division·factory·product·customer
      // 전부를 정렬에 담는다, `20260515000001_create_pnl_entries.sql`).
      .order('sil', { ascending: true })
      .order('division', { ascending: true })
      .order('factory', { ascending: true })
      .order('product', { ascending: true })
      .order('customer', { ascending: true })
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
 * 손익 페이지 데이터 — raw fetch + 서버 사전 가공 + 1일 캐시(sync 시 무효화로 즉시 반영).
 *
 * - 캐시 무효화: scripts/lib/revalidate.py가 `pnl_entries` 태그 갱신.
 * - `preparePnlData`는 pure 함수 — cache hit 시 prepared 객체가 그대로 반환되어
 *   client useMemo(preparePnlData) 단계가 사라진다 (PnlDashboard hydration ↓).
 */
export async function getPreparedPnl(): Promise<PreparedPnlData> {
  'use cache';
  cacheLife('days');
  cacheTag('pnl_entries');

  const raw = await fetchPnlEntries();
  return preparePnlData(raw);
}

/**
 * `pnl_cost_structure` 전체 fetch + 1일 캐시(sync 시 무효화로 즉시 반영).
 *
 * ≤ 수백 행이라 페이지네이션 불필요.
 */
export async function getCostStructure(): Promise<CostStructureRow[]> {
  'use cache';
  cacheLife('days');
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

/**
 * `pnl_fixed_variable` 전체 fetch + 1일 캐시(sync 시 무효화로 즉시 반영).
 *
 * 비용 계정을 고정비/변동비로 분해한 행. ≤ 수백 행이라 페이지네이션 불필요.
 */
export async function getFixedVariable(): Promise<FixedVariableRow[]> {
  'use cache';
  cacheLife('days');
  cacheTag('pnl_fixed_variable');

  const { data, error } = await confidentialDb
    .from('pnl_fixed_variable')
    .select('*')
    .order('period_year', { ascending: true })
    .order('period_month', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'pnl_fixed_variable 조회 실패');
    throw new Error(`Supabase pnl_fixed_variable 조회 실패: ${error.message}`);
  }
  // Row와 FixedVariableRow는 period_kind / cost_type만 narrow union이 필요.
  return (data ?? []).map((row) => ({
    ...row,
    period_kind: row.period_kind as 'annual' | 'monthly',
    cost_type: row.cost_type as FixedVariableRow['cost_type'],
  }));
}
