import { NextResponse } from 'next/server';

import { isAdmin } from '@/lib/auth/permissions';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { dispatchWorkflow } from '@/lib/github/workflow-dispatch';
import logger from '@/lib/logger';
import { fail, ok } from '@/lib/reports/api-response';
import { confidentialDb } from '@/lib/supabase/confidential';

const WORKFLOW = 'sync-management.yml';

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

/**
 * 적재 확정. status가 dry_run_ok일 때만 apply 모드 workflow_dispatch.
 * admin 전용. mismatch는 차단하지 않음(경고만, spec §11 결정).
 */
export async function POST(_req: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json(fail('UNAUTHORIZED', '로그인이 필요합니다.'), { status: 401 });
  if (!isAdmin(user.role))
    return NextResponse.json(fail('FORBIDDEN', '관리자만 사용할 수 있습니다.'), { status: 403 });

  const { jobId } = await params;
  const { data: job, error } = await confidentialDb
    .from('management_uploads')
    .select('id, status, excel_path')
    .eq('id', jobId)
    .maybeSingle();
  if (error) return NextResponse.json(fail('LOOKUP_FAILED', error.message), { status: 500 });
  if (!job)
    return NextResponse.json(fail('NOT_FOUND', '작업을 찾을 수 없습니다.'), { status: 404 });
  if (job.status !== 'dry_run_ok')
    return NextResponse.json(
      fail('INVALID_STATE', `dry-run 성공 상태에서만 적재할 수 있습니다 (현재: ${job.status}).`),
      { status: 409 }
    );

  const dispatch = await dispatchWorkflow(WORKFLOW, {
    job_id: jobId,
    excel_path: job.excel_path,
    mode: 'apply',
  });
  if (!dispatch.ok) {
    logger.warn({ err: dispatch.error, jobId }, 'apply dispatch 실패');
    return NextResponse.json(fail('DISPATCH_FAILED', dispatch.error ?? 'dispatch 실패'), {
      status: 502,
    });
  }

  // dry_run_ok일 때만 applying으로 전이. GHA 오케스트레이터가 먼저 applied/apply_failed로
  // 옮겼다면 이 update는 no-op이 되어 status를 되돌리지 않는다(폴링 영구 고착 방지).
  await confidentialDb
    .from('management_uploads')
    .update({ status: 'applying' })
    .eq('id', jobId)
    .eq('status', 'dry_run_ok');
  return NextResponse.json(ok({ job_id: jobId }));
}
