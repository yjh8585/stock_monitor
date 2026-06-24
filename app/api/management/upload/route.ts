import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { isAdmin } from '@/lib/auth/permissions';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { dispatchWorkflow } from '@/lib/github/workflow-dispatch';
import logger from '@/lib/logger';
import { MAX_XLSX_BYTES } from '@/lib/management/upload-schema';
import { fail, ok } from '@/lib/reports/api-response';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { confidentialDb } from '@/lib/supabase/confidential';

const BUCKET = 'management-excel';
const WORKFLOW = 'sync-management.yml';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * 경영관리 엑셀 업로드 → 비공개 버킷 저장 → management_uploads INSERT
 * → sync-management.yml(dry-run) workflow_dispatch. 응답 { job_id }.
 * admin 전용. dispatch 실패해도 작업행은 유지(graceful), error_msg 기록.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json(fail('UNAUTHORIZED', '로그인이 필요합니다.'), { status: 401 });
  if (!isAdmin(user.role))
    return NextResponse.json(fail('FORBIDDEN', '관리자만 사용할 수 있습니다.'), { status: 403 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(fail('INVALID_FORM', 'multipart 요청이 아닙니다.'), { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File))
    return NextResponse.json(fail('FILE_REQUIRED', 'file 필드가 필요합니다.'), { status: 400 });
  if (file.size === 0)
    return NextResponse.json(fail('EMPTY_FILE', '빈 파일은 업로드할 수 없습니다.'), {
      status: 400,
    });
  if (file.size > MAX_XLSX_BYTES)
    return NextResponse.json(fail('FILE_TOO_LARGE', '50MB 이하만 업로드 가능합니다.'), {
      status: 400,
    });
  const isXlsx =
    file.name.toLowerCase().endsWith('.xlsx') && (file.type === XLSX_MIME || file.type === '');
  if (!isXlsx)
    return NextResponse.json(fail('INVALID_TYPE', '.xlsx 파일만 업로드 가능합니다.'), {
      status: 400,
    });

  const jobId = randomUUID();
  const objectPath = `${new Date().toISOString().slice(0, 10)}/${jobId}.xlsx`;

  const admin = createSupabaseAdminClient();
  const arrayBuffer = await file.arrayBuffer();
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(objectPath, Buffer.from(arrayBuffer), { contentType: XLSX_MIME, upsert: false });
  if (upErr) {
    logger.error({ err: upErr }, '엑셀 업로드 실패');
    return NextResponse.json(fail('UPLOAD_FAILED', '엑셀 업로드에 실패했습니다.'), {
      status: 500,
    });
  }

  const { error: insErr } = await confidentialDb.from('management_uploads').insert({
    id: jobId,
    status: 'uploaded',
    excel_path: objectPath,
    file_name: file.name,
    uploaded_by: user.id,
  });
  if (insErr) {
    logger.error({ err: insErr }, 'management_uploads INSERT 실패');
    return NextResponse.json(fail('INSERT_FAILED', insErr.message), { status: 500 });
  }

  const dispatch = await dispatchWorkflow(WORKFLOW, {
    job_id: jobId,
    excel_path: objectPath,
    mode: 'dry-run',
  });
  if (!dispatch.ok) {
    logger.warn({ err: dispatch.error, jobId }, 'sync-management dispatch 실패 — 작업행 유지');
    await confidentialDb
      .from('management_uploads')
      .update({ status: 'dry_run_failed', error_msg: `dispatch 실패: ${dispatch.error}` })
      .eq('id', jobId);
  }

  return NextResponse.json(
    ok({ job_id: jobId, dispatchError: dispatch.ok ? null : dispatch.error }),
    { status: 201 }
  );
}
