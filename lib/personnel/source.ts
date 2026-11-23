/**
 * 인원(/management/personnel) 도메인 데이터 입구 — fetch + 'use cache'.
 *
 * - personnel_entries: 사외비 → confidentialDb(service_role).
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { confidentialDb } from '@/lib/supabase/confidential';
import { fetchAllPages } from '@/lib/supabase/fetchAllPages';
import type { PersonnelRow } from './types';

async function fetchPersonnelRows(): Promise<PersonnelRow[]> {
  // 정렬 = PK 전체(region, detail, kind, period_date) — 페이지 경계 누락·중복 방지
  const data = await fetchAllPages('personnel_entries', (from, to) =>
    confidentialDb
      .from('personnel_entries')
      .select('*')
      .order('region', { ascending: true })
      .order('detail', { ascending: true })
      .order('kind', { ascending: true })
      .order('period_date', { ascending: true })
      .range(from, to)
  );
  return data.map((r) => ({
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
  cacheLife('days');
  cacheTag('personnel_entries');
  const rows = await fetchPersonnelRows();
  return { rows };
}
