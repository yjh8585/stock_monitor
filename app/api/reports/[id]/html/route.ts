import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canAccessConfidentialReports } from '@/lib/auth/permissions';
import logger from '@/lib/logger';
import { PostRepository } from '@/lib/reports/repositories/post.repository';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const BUCKET = 'reports-html';

/**
 * 원본 HTML 보고서 스트리밍. 비공개 버킷이라 service_role(admin client)로 download.
 * proxy.ts 가 1차 게이트(로그인)지만, 라우트에서도 재검증한다(defense-in-depth).
 *
 * 🔴 사외비 판정은 경로가 아니라 **행 단위**다. `canAccess()` 는 매칭 분기가 없으면
 * true 를 반환하고 `/reports` 는 전 역할 공개라, permissions.ts 에 `/api/reports` 분기를
 * 추가하면 guest 의 정상 열람까지 막힌다. 대신 여기서 post.is_confidential 을 직접 본다.
 *
 * 🔴 오류 응답 본문에는 파일 경로·제목·사유를 넣지 않는다(사외비).
 *
 * posts 는 CONFIDENTIAL_TABLES 명단에 없어(RLS 정책이 있는 테이블이다) `confidentialDb`
 * 로는 조회할 수 없다 — org-chart 라우트와 달리 메타 조회를 PostRepository 로 한다.
 */
export async function GET(_req: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const { id } = await params;
  const postId = Number(id);
  // 🔴 Number.isFinite 는 소수(1.5)·거대 지수를 통과시킨다 — 그 값이 PostgREST 의
  // bigint 캐스트까지 내려가 500 이 된다. 여기서 400 으로 막는다.
  if (!Number.isInteger(postId) || postId <= 0) {
    return new NextResponse('Bad Request', { status: 400 });
  }

  // service_role 로 읽고(사외비 행 포함) 아래에서 역할을 직접 판정한다.
  const post = await new PostRepository().findById(postId, true);

  // 🔴 권한 판정을 첨부 유무 판정보다 **먼저** 하고, 실패는 403 이 아니라 404 로 돌려준다.
  // 403/404 가 갈리면 무권한 계정이 id 를 훑어 「사외비 글이 있고 원본 HTML 첨부까지 있다」를
  // 목록화할 수 있다. 같은 글의 페이지(`/reports/[id]`)도 notFound() 로 존재 자체를 숨기므로
  // 두 입구의 태도를 맞춘다.
  if (post?.is_confidential && !canAccessConfidentialReports(user.role)) {
    return new NextResponse('Not Found', { status: 404 });
  }
  if (!post?.html_path) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const admin = createSupabaseAdminClient();
  const { data: blob, error } = await admin.storage.from(BUCKET).download(post.html_path);
  if (error || !blob) {
    // 버킷명 오타·객체 누락·권한 문제가 전부 같은 404 로 나가므로 여기서만 구분이 남는다.
    logger.error({ err: error, postId, bucket: BUCKET }, '원본 HTML 다운로드 실패');
    return new NextResponse('Not Found', { status: 404 });
  }

  // Blob 을 그대로 넘기면 Content-Length 가 붙어 Vercel 응답 본문 4.5MB 상한(413
  // FUNCTION_PAYLOAD_TOO_LARGE)을 탄다. stream() 으로 넘겨 청크 전송 경로로 보내면
  // 상한이 사라진다 — Content-Length 를 직접 세팅하면 버퍼 경로로 되돌아가므로 금지.
  return new NextResponse(blob.stream(), {
    status: 200,
    headers: {
      // Storage 객체의 contentType 이 octet-stream 이면 브라우저가 다운로드해 버린다 — 명시한다.
      'Content-Type': 'text/html; charset=utf-8',
      // 외부 사이트의 프레이밍만 차단. 우리 same-origin 임베드는 그대로 허용된다.
      'Content-Security-Policy': "frame-ancestors 'self'",
      'X-Content-Type-Options': 'nosniff',
      // 사외비 — 브라우저 디스크 캐시 금지(공유 PC에서 권한 변경 후 캐시 노출 방지).
      // 매 조회마다 서버 권한 게이트를 다시 거치게 한다.
      'Cache-Control': 'private, no-store',
      // 🔴 Permissions-Policy 를 절대 붙이지 말 것 — 보고서 문서에 declared policy 가
      // 생기는 순간 안쪽 유튜브(교차 origin) iframe 으로의 권한 위임이 조용히 끊긴다.
    },
  });
}
