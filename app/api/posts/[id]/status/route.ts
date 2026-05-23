import { NextResponse } from 'next/server';

import logger from '@/lib/logger';
import { fail, ok } from '@/lib/reports/api-response';
import { PostRepository } from '@/lib/reports/repositories/post.repository';

const postRepo = new PostRepository();

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * 폴링용 경량 상태 조회. 본문 없이 status/error 만 반환.
 */
export async function GET(_req: Request, { params }: RouteContext) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) {
    return NextResponse.json(fail('INVALID_ID', '유효하지 않은 ID 입니다.'), { status: 400 });
  }

  try {
    const row = await postRepo.findById(numericId);
    if (!row) {
      return NextResponse.json(fail('NOT_FOUND', '게시글을 찾을 수 없습니다.'), { status: 404 });
    }
    return NextResponse.json(
      ok({
        id: row.id,
        status: row.status,
        error_message: row.error_message,
      })
    );
  } catch (err) {
    logger.error({ err, id: numericId }, '상태 조회 실패');
    return NextResponse.json(fail('STATUS_FAILED', '상태 조회에 실패했습니다.'), { status: 500 });
  }
}
