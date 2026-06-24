import { NextResponse } from 'next/server';

import { isAdmin } from '@/lib/auth/permissions';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { fail, ok } from '@/lib/reports/api-response';
import { confidentialDb } from '@/lib/supabase/confidential';

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

/**
 * 업로드 작업 폴링. admin 전용. 금액 비노출(summary엔 행수/연도/경고만).
 */
export async function GET(_req: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json(fail('UNAUTHORIZED', '로그인이 필요합니다.'), { status: 401 });
  if (!isAdmin(user.role))
    return NextResponse.json(fail('FORBIDDEN', '관리자만 사용할 수 있습니다.'), { status: 403 });

  const { jobId } = await params;
  const { data, error } = await confidentialDb
    .from('management_uploads')
    .select('id, status, file_name, summary, error_msg')
    .eq('id', jobId)
    .maybeSingle();
  if (error) return NextResponse.json(fail('LOOKUP_FAILED', error.message), { status: 500 });
  if (!data)
    return NextResponse.json(fail('NOT_FOUND', '작업을 찾을 수 없습니다.'), { status: 404 });

  return NextResponse.json(ok(data));
}
