import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import logger from '@/lib/logger';
import { fail, ok } from '@/lib/reports/dto/api.dto';
import { PostService } from '@/lib/reports/services/post.service';

const postService = new PostService();

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
    const row = await postService.findById(numericId);
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
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) {
    return NextResponse.json(fail('INVALID_ID', '유효하지 않은 ID 입니다.'), { status: 400 });
  }

  try {
    await postService.delete(numericId);
    // 삭제 후 목록·상세 캐시 무효화
    revalidateTag('posts', 'max');
    revalidateTag(`post:${numericId}`, 'max');
    return NextResponse.json(ok({ id: numericId }));
  } catch (err) {
    logger.error({ err, id: numericId }, '게시글 삭제 실패');
    return NextResponse.json(fail('DELETE_FAILED', '게시글 삭제에 실패했습니다.'), { status: 500 });
  }
}
