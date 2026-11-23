import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canReadPost, isAdmin } from '@/lib/auth/permissions';
import logger from '@/lib/logger';
import { fail, ok } from '@/lib/reports/api-response';
import { PostRepository } from '@/lib/reports/repositories/post.repository';

const postRepo = new PostRepository();

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  // 상세 화면·첨부 프록시와 같은 열람 판정(canReadPost). 사외비 행은 anon RLS 가 거르지만
  // 경영표준(카테고리 판정)은 RLS 밖이다(2026-11-20 코드 리뷰 「낮음·참고」).
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(fail('UNAUTHORIZED', '로그인이 필요합니다.'), { status: 401 });
  }
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) {
    return NextResponse.json(fail('INVALID_ID', '유효하지 않은 ID 입니다.'), { status: 400 });
  }

  try {
    const row = await postRepo.findById(numericId);
    // 권한 없음도 404 — 403 이면 id 를 훑어 감춘 글의 존재를 알아낸다(html 프록시와 같은 태도)
    if (!row || !canReadPost(user.role, row)) {
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
