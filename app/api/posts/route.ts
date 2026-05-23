import { revalidateTag } from 'next/cache';
import { after, NextResponse } from 'next/server';

import logger from '@/lib/logger';

export const maxDuration = 300; // PDF/웹 분석은 Claude API 호출로 최대 5분 소요
import { fail, ok } from '@/lib/reports/api-response';
import { createPostInputSchema, postListQuerySchema } from '@/lib/reports/dto/post.dto';
import { PostRepository } from '@/lib/reports/repositories/post.repository';
import { PostService } from '@/lib/reports/services/post.service';

const postRepo = new PostRepository();
const postService = new PostService(postRepo);

/**
 * 게시글 목록 조회.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = postListQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(fail('INVALID_QUERY', parsed.error.message), { status: 400 });
  }
  const { page, pageSize } = parsed.data;

  try {
    const result = await postRepo.list(page, pageSize);
    return NextResponse.json(ok({ ...result, page, pageSize }));
  } catch (err) {
    logger.error({ err }, '게시글 목록 조회 실패');
    return NextResponse.json(fail('LIST_FAILED', '게시글 목록을 불러오지 못했습니다.'), {
      status: 500,
    });
  }
}

/**
 * 게시글 생성. 메타만 즉시 INSERT, 본문은 백그라운드 처리.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(fail('INVALID_JSON', '요청 본문이 올바른 JSON 이 아닙니다.'), {
      status: 400,
    });
  }

  const parsed = createPostInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(fail('INVALID_INPUT', parsed.error.message), { status: 400 });
  }
  const input = parsed.data;

  try {
    const row = await postService.createInitial(input);

    // 신규 글 — 목록 캐시 즉시 무효화
    revalidateTag('posts', 'max');

    after(async () => {
      await postService.runBackground(row.id, input);
      // 본문 완료/실패 후 상세·목록 캐시 갱신
      revalidateTag('posts', 'max');
      revalidateTag(`post:${row.id}`, 'max');
    });

    return NextResponse.json(ok({ id: row.id, status: row.status }), { status: 202 });
  } catch (err) {
    logger.error({ err }, '게시글 생성 실패');
    return NextResponse.json(fail('CREATE_FAILED', '게시글 생성에 실패했습니다.'), {
      status: 500,
    });
  }
}
