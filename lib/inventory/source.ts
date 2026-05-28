/**
 * 재고(/management/inventory) 도메인 데이터 입구 — fetch + 'use cache'.
 *
 * - inventory_entries: 사외비 → confidentialDb(service_role).
 * - 환산은 lib/inventory/aggregate.ts에서 수행 (DB는 원본 단위 보존).
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { confidentialDb } from '@/lib/supabase/confidential';
import type { InventoryRow } from './types';

async function fetchInventoryRows(): Promise<InventoryRow[]> {
  const { data, error } = await confidentialDb
    .from('inventory_entries')
    .select('*')
    .order('category', { ascending: true })
    .order('item', { ascending: true })
    .order('period_year', { ascending: true })
    .order('period_month', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'inventory_entries 조회 실패');
    throw new Error(`Supabase inventory_entries 조회 실패: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    ...r,
    kind: r.kind as InventoryRow['kind'],
  }));
}

export interface InventoryData {
  rows: InventoryRow[];
}

export async function getInventoryData(): Promise<InventoryData> {
  'use cache';
  cacheLife('hours');
  cacheTag('inventory_entries');

  const rows = await fetchInventoryRows();
  return { rows };
}
