/**
 * 재무(/management/finance) 도메인 데이터 입구 — fetch + 'use cache'.
 *
 * - finance_entries: 사외비 → confidentialDb(service_role).
 * - 환산(억원)·집계는 lib/finance/aggregate.ts에서 수행 (DB는 백만원 원본 보존).
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { confidentialDb } from '@/lib/supabase/confidential';
import { getFixedVariable, getPreparedPnl } from '@/lib/pnl/source';
import { buildPnlDerived } from './pnl-derived';
import type { FinanceRow, LoanRow, PnlDerivedSeries } from './types';

const SUPABASE_PAGE_SIZE = 1000;

/**
 * 전체 행 — 1,000행 단위 페이지로 끝까지 읽는다(Supabase 기본 상한이 1,000행이라 한 번에 읽으면
 * 넘는 순간 뒤쪽이 조용히 잘린다). 적재는 upsert 만 해 지난 연도 월별 행이 남으므로 해마다 는다
 * (2026-11 566행 · 자금수지 흐름 계정 10종 추가로 2027 초에 1,000행을 넘는다).
 * 페이지 경계가 흔들리지 않게 PK 6칼럼 전부로 정렬한다(`20260610000001`).
 */
async function fetchFinanceRows(): Promise<FinanceRow[]> {
  const all: FinanceRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await confidentialDb
      .from('finance_entries')
      .select('*')
      .order('subsidiary', { ascending: true })
      .order('consolidation', { ascending: true })
      .order('period_year', { ascending: true })
      .order('period_kind', { ascending: true })
      .order('period_month', { ascending: true })
      .order('account', { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) {
      logger.error({ err: error }, 'finance_entries 조회 실패');
      throw new Error(`Supabase finance_entries 조회 실패: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    for (const r of data) {
      all.push({ ...r, period_kind: r.period_kind as FinanceRow['period_kind'] });
    }
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}

export interface FinanceData {
  rows: FinanceRow[];
  /** 자금조달 표 영업이익·상각비 — 재무엔 없거나 불완전해 pnl(손익)에서 추출(억원). */
  pnlDerived: PnlDerivedSeries;
}

export async function getFinanceData(): Promise<FinanceData> {
  'use cache';
  cacheLife('days');
  cacheTag('finance_entries');
  // 영업이익(pnl_entries)·상각비(pnl_fixed_variable) 의존 → 손익 적재 시에도 무효화
  cacheTag('pnl_entries');
  cacheTag('pnl_fixed_variable');

  const [rows, prepared, fixedVariable] = await Promise.all([
    fetchFinanceRows(),
    getPreparedPnl(),
    getFixedVariable(),
  ]);
  return { rows, pnlDerived: buildPnlDerived(prepared, fixedVariable) };
}

async function fetchLoanRows(): Promise<LoanRow[]> {
  const { data, error } = await confidentialDb
    .from('loan_entries')
    .select('*')
    .order('period_year', { ascending: true })
    .order('period_month', { ascending: true })
    .order('kind', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'loan_entries 조회 실패');
    throw new Error(`Supabase loan_entries 조회 실패: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    ...r,
    kind: r.kind as LoanRow['kind'],
  }));
}

export interface LoanData {
  rows: LoanRow[];
}

export async function getLoanData(): Promise<LoanData> {
  'use cache';
  cacheLife('days');
  cacheTag('loan_entries');

  const rows = await fetchLoanRows();
  return { rows };
}
