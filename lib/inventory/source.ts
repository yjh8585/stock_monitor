/**
 * 재고(/management/inventory) 도메인 데이터 입구 — fetch + 'use cache'.
 *
 * - inventory_entries: 사외비 → confidentialDb(service_role).
 * - 환산은 lib/inventory/aggregate.ts에서 수행 (DB는 원본 단위 보존).
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { confidentialDb } from '@/lib/supabase/confidential';
import { fetchAllPages } from '@/lib/supabase/fetchAllPages';
import type { InventoryRow } from './types';

async function fetchInventoryRows(): Promise<InventoryRow[]> {
  // 정렬 = PK 전체(category, item, kind, period_year, period_month) — 페이지 경계 누락·중복 방지
  const data = await fetchAllPages('inventory_entries', (from, to) =>
    confidentialDb
      .from('inventory_entries')
      .select('*')
      .order('category', { ascending: true })
      .order('item', { ascending: true })
      .order('kind', { ascending: true })
      .order('period_year', { ascending: true })
      .order('period_month', { ascending: true })
      .range(from, to)
  );
  return data.map((r) => ({
    ...r,
    kind: r.kind as InventoryRow['kind'],
  }));
}

export interface InventoryData {
  rows: InventoryRow[];
}

export async function getInventoryData(): Promise<InventoryData> {
  'use cache';
  cacheLife('days');
  cacheTag('inventory_entries');

  const rows = await fetchInventoryRows();
  return { rows };
}
