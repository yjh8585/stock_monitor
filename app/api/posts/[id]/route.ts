import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/get-current-user';
import { isAdmin } from '@/lib/auth/permissions';
import logger from '@/lib/logger';
import { fail, ok } from '@/lib/reports/api-response';
import { PostRepository } from '@/lib/reports/repositories/post.repository';

const postRepo = new PostRepository();

interface RouteContext {
  params: Promise<{ id: string }>;
}

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
    return NextResponse.json(ok(row));
  } catch (err) {
    logger.error({ err, id: numericId }, '게시글 조회 실패');
    return NextResponse.json(fail('FETCH_FAILED', '게시글 조회에 실패했습니다.'), { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  // 관리자만 삭제 가능 — UI 가드(상세 페이지에서 버튼 숨김)와 이중 보호.
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) {
    return NextResponse.json(fail('FORBIDDEN', '삭제 권한이 없습니다.'), { status: 403 });
  }

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) {
    return NextResponse.json(fail('INVALID_ID', '유효하지 않은 ID 입니다.'), { status: 400 });
  }

  try {
    await postRepo.delete(numericId);
    // 삭제 후 목록·상세 캐시 무효화
    revalidateTag('posts', 'max');
    revalidateTag(`post:${numericId}`, 'max');
    return NextResponse.json(ok({ id: numericId }));
  } catch (err) {
    logger.error({ err, id: numericId }, '게시글 삭제 실패');
    return NextResponse.json(fail('DELETE_FAILED', '게시글 삭제에 실패했습니다.'), { status: 500 });
  }
}
