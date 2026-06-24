import { NextResponse } from 'next/server';

import { canAccess } from '@/lib/auth/permissions';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { confidentialDb } from '@/lib/supabase/confidential';

interface RouteContext {
  params: Promise<{ date: string }>;
}

const BUCKET = 'org-charts';

/**
 * 조직도 이미지 스트리밍. 비공개 버킷이라 service_role(admin client)로 download.
 * proxy.ts가 1차 게이트(canAccess)지만, 라우트에서도 role 재검증(defense-in-depth).
 */
export async function GET(_req: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user || !canAccess('/management/org-chart', user.role)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new NextResponse('Bad Request', { status: 400 });
  }

  const { data: meta, error } = await confidentialDb
    .from('org_charts')
    .select('image_path')
    .eq('chart_date', date)
    .maybeSingle();
  if (error || !meta) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const admin = createSupabaseAdminClient();
  const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(meta.image_path);
  if (dlErr || !blob) {
    return new NextResponse('Not Found', { status: 404 });
  }

  return new NextResponse(blob, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=300',
    },
  });
}
