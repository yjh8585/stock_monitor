/**
 * 조직도(/management/org-chart) 메타 입구 — fetch + 'use cache'.
 *
 * org_charts: 사외비 → confidentialDb(service_role).
 * image_path는 여기서 select하지 않는다(서버 전용) — 이미지는 날짜별 인증 API가 스트리밍.
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';

import logger from '@/lib/logger';
import { confidentialDb } from '@/lib/supabase/confidential';

export interface OrgChartMeta {
  chart_date: string;
  title: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

export async function getOrgCharts(): Promise<OrgChartMeta[]> {
  'use cache';
  cacheLife('days');
  cacheTag('org_charts');

  const { data, error } = await confidentialDb
    .from('org_charts')
    .select('chart_date, title, width, height, created_at')
    .order('chart_date', { ascending: false });
  if (error) {
    logger.error({ err: error }, 'org_charts 조회 실패');
    throw new Error(`Supabase org_charts 조회 실패: ${error.message}`);
  }
  return data ?? [];
}
