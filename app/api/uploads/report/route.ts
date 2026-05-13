import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import logger from '@/lib/logger';
import { fail, ok } from '@/lib/reports/dto/api.dto';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const REPORTS_BUCKET = 'reports';
const MAX_BYTES = 100 * 1024 * 1024; // 100MB

/**
 * PDF 보고서 업로드. 폼 제출 전에 호출되어 file_path 를 반환한다.
 */
export async function POST(req: Request) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(fail('INVALID_FORM', 'multipart 요청이 아닙니다.'), { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(fail('FILE_REQUIRED', 'file 필드가 필요합니다.'), { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json(fail('EMPTY_FILE', '빈 파일은 업로드할 수 없습니다.'), {
      status: 400,
    });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(fail('FILE_TOO_LARGE', '100MB 이하의 파일만 업로드 가능합니다.'), {
      status: 400,
    });
  }
  if (file.type !== 'application/pdf') {
    return NextResponse.json(fail('INVALID_TYPE', 'PDF 파일만 업로드 가능합니다.'), {
      status: 400,
    });
  }

  const supabase = createSupabaseAdminClient();
  const ext = pickPdfExtension(file.name);
  const objectPath = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error } = await supabase.storage
    .from(REPORTS_BUCKET)
    .upload(objectPath, Buffer.from(arrayBuffer), {
      contentType: 'application/pdf',
      cacheControl: '31536000',
      upsert: false,
    });

  if (error) {
    logger.error({ err: error }, 'PDF 업로드 실패');
    return NextResponse.json(fail('UPLOAD_FAILED', 'PDF 업로드에 실패했습니다.'), { status: 500 });
  }

  const { data: pub } = supabase.storage.from(REPORTS_BUCKET).getPublicUrl(objectPath);

  return NextResponse.json(
    ok({
      file_path: objectPath,
      file_name: file.name,
      public_url: pub.publicUrl,
    })
  );
}

/**
 * Supabase Storage 객체 키는 ASCII 안전 문자만 허용한다.
 * 원본 파일명은 file_name 컬럼에 그대로 저장되므로, 키에는 확장자만 사용한다.
 */
function pickPdfExtension(name: string): string {
  const match = name.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] ?? '.pdf';
}
