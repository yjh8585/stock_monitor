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

  // summary의 스크립트별 raw stdout(output)은 UI가 렌더하지 않으므로 응답에서 제거 —
  // 노출면 최소화(name/ok/exit_code + warnings만 내려보낸다).
  return NextResponse.json(ok({ ...data, summary: sanitizeSummary(data.summary) }));
}

/** summary JSONB에서 스크립트별 raw output을 떼어낸다(금액 비노출 강화). */
function sanitizeSummary(summary: unknown): unknown {
  if (!summary || typeof summary !== 'object') return summary;
  const s = summary as {
    ok?: unknown;
    warnings?: unknown;
    scripts?: Array<{ name?: unknown; ok?: unknown; exit_code?: unknown }>;
  };
  if (!Array.isArray(s.scripts)) return summary;
  return {
    ok: s.ok,
    warnings: s.warnings,
    scripts: s.scripts.map((item) => ({
      name: item?.name,
      ok: item?.ok,
      exit_code: item?.exit_code,
    })),
  };
}
