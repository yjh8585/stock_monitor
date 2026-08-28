import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canAccessConfidentialReports } from '@/lib/auth/permissions';
import logger from '@/lib/logger';
import { PostRepository } from '@/lib/reports/repositories/post.repository';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const BUCKET = 'reports-video';

/** 서명 URL 유효기간(초). 6분짜리 영상 한 편을 끊김 없이 다 보고도 남는 길이. */
const SIGNED_URL_TTL_SEC = 3600;

/**
 * 첨부 동영상 재생 끝점. 권한을 확인한 뒤 **비공개 버킷의 단기 서명 URL 로 307** 한다.
 *
 * 🔴 원본 HTML 라우트(`../html/route.ts`)처럼 바이트를 직접 흘리지 않는다. 영상은 100MB
 * 안팎이고 브라우저가 탐색할 때마다 Range 요청을 새로 던지는데, 서버리스 함수로 그걸 전부
 * 중계하면 실행시간·대역폭을 태우고 `blob.stream()` 경로는 Range 를 해석하지 않아
 * **구간 탐색이 아예 안 된다**. 서명 URL 로 넘기면 Storage 가 Range 를 직접 처리한다.
 *
 * 🔴 사외비 판정은 경로가 아니라 **행 단위**다(html 라우트와 같은 이유). `canAccess()` 는
 * 매칭 분기가 없으면 true 를 반환하고 `/reports` 는 전 역할 공개라, permissions.ts 에
 * `/api/reports` 분기를 추가하면 guest 의 정상 열람까지 막힌다. 여기서 직접 본다.
 *
 * 🔴 오류 응답 본문에는 파일 경로·제목·사유를 넣지 않는다(사외비).
 */
export async function GET(_req: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const { id } = await params;
  const postId = Number(id);
  // Number.isFinite 는 소수·거대 지수를 통과시켜 PostgREST 의 bigint 캐스트에서 500 이 된다.
  if (!Number.isInteger(postId) || postId <= 0) {
    return new NextResponse('Bad Request', { status: 400 });
  }

  // service_role 로 읽고(사외비 행 포함) 아래에서 역할을 직접 판정한다.
  const post = await new PostRepository().findById(postId, true);

  // 권한 판정을 첨부 유무 판정보다 **먼저** 하고, 실패는 403 이 아니라 404 로 돌려준다.
  // 403/404 가 갈리면 무권한 계정이 id 를 훑어 「사외비 글에 영상 첨부가 있다」를 목록화할 수 있다.
  if (post?.is_confidential && !canAccessConfidentialReports(user.role)) {
    return new NextResponse('Not Found', { status: 404 });
  }
  if (!post?.video_path) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(post.video_path, SIGNED_URL_TTL_SEC);

  if (error || !data?.signedUrl) {
    // 버킷명 오타·객체 누락·권한 문제가 전부 같은 404 로 나가므로 여기서만 구분이 남는다.
    logger.error({ err: error, postId, bucket: BUCKET }, '동영상 서명 URL 생성 실패');
    return new NextResponse('Not Found', { status: 404 });
  }

  // 307(temporary) — 브라우저가 Range 요청을 그대로 들고 따라간다. 서명 URL 이 응답에
  // 실리므로 캐시 금지(만료된 URL 이 캐시에 남으면 재생이 조용히 깨진다).
  return NextResponse.redirect(data.signedUrl, {
    status: 307,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
