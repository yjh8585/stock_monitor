/**
 * 인원(/management/personnel) 도메인 데이터 입구 — fetch + 'use cache'.
 *
 * - personnel_entries: 사외비 → confidentialDb(service_role).
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { confidentialDb } from '@/lib/supabase/confidential';
import type { PersonnelRow } from './types';

async function fetchPersonnelRows(): Promise<PersonnelRow[]> {
  const { data, error } = await confidentialDb
    .from('personnel_entries')
    .select('*')
    .order('region', { ascending: true })
    .order('detail', { ascending: true })
    .order('kind', { ascending: true })
    .order('period_date', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'personnel_entries 조회 실패');
    throw new Error(`Supabase personnel_entries 조회 실패: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    ...r,
    region: r.region as PersonnelRow['region'],
    kind: r.kind as PersonnelRow['kind'],
  }));
}

export interface PersonnelData {
  rows: PersonnelRow[];
}

export async function getPersonnelData(): Promise<PersonnelData> {
  'use cache';
  cacheLife('hours');
  cacheTag('personnel_entries');
  const rows = await fetchPersonnelRows();
  return { rows };
}
