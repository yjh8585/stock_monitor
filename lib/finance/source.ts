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
import type { FinanceRow } from './types';

async function fetchFinanceRows(): Promise<FinanceRow[]> {
  const { data, error } = await confidentialDb
    .from('finance_entries')
    .select('*')
    .order('subsidiary', { ascending: true })
    .order('period_year', { ascending: true })
    .order('period_month', { ascending: true })
    .order('account', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'finance_entries 조회 실패');
    throw new Error(`Supabase finance_entries 조회 실패: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    ...r,
    period_kind: r.period_kind as FinanceRow['period_kind'],
  }));
}

export interface FinanceData {
  rows: FinanceRow[];
}

export async function getFinanceData(): Promise<FinanceData> {
  'use cache';
  cacheLife('days');
  cacheTag('finance_entries');

  const rows = await fetchFinanceRows();
  return { rows };
}
