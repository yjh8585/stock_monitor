import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cacheLife, cacheTag } from 'next/cache';
import { Suspense } from 'react';
import dayjs from 'dayjs';

import { MarkdownView } from '@/components/reports/markdown-view';
import { PostDeleteButton } from '@/components/reports/post-delete-button';
import { PostSourceBadge } from '@/components/reports/post-source-badge';
import { PostStatusBadge } from '@/components/reports/post-status-badge';
import { PostStatusWatcher } from '@/components/reports/post-status-watcher';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { isAdmin } from '@/lib/auth/permissions';
import { PostRepository } from '@/lib/reports/repositories/post.repository';

/**
 * Cache Components 는 generateStaticParams 가 최소 1개 반환을 요구한다.
 * 실제 데이터에 매칭되지 않는 placeholder 만 prerender 하고, 나머지는 dynamicParams 로 런타임 생성.
 */
export async function generateStaticParams() {
  return [{ id: '0' }];
}

interface PageProps {
  params: Promise<{ id: string }>;
}

const SUPABASE_PUBLIC_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/reports`;

/**
 * Storage 객체 키는 UUID 이므로, 다운로드 시 브라우저가 원본 한글 파일명을
 * 사용하도록 `?download=<원본>` 쿼리를 붙인다. Supabase Storage 가 응답에
 * Content-Disposition: attachment; filename="..." 헤더를 자동으로 설정.
 */
function buildReportDownloadUrl(filePath: string, fileName: string | null): string {
  const base = `${SUPABASE_PUBLIC_URL}/${filePath}`;
  const downloadName = fileName?.trim() ? fileName.trim() : 'report.pdf';
  return `${base}?download=${encodeURIComponent(downloadName)}`;
}

/**
 * 게시글 상세를 Cache Components 로 캐싱.
 * cacheTag(`post:${id}`) — 상태 변경/삭제 시 revalidateTag 로 무효화.
 */
async function getPostDetail(id: number) {
  'use cache';
  cacheLife('hours');
  cacheTag(`post:${id}`);

  const repo = new PostRepository();
  return repo.findById(id);
}

async function ReportDetailBody({ params }: PageProps) {
  const { id } = await params;
  const postId = Number(id);
  if (!Number.isFinite(postId)) notFound();

  const post = await getPostDetail(postId);
  if (!post) notFound();

  // 삭제 권한은 관리자만 — UI 가드와 DELETE API 가드 이중 보호.
  // getCurrentUser는 cookies()를 쓰므로 'use cache' 함수 외부에서만 호출 가능.
  const currentUser = await getCurrentUser();
  const canDelete = currentUser ? isAdmin(currentUser.role) : false;

  const reportFileUrl = post.file_path
    ? buildReportDownloadUrl(post.file_path, post.file_name)
    : null;

  return (
    <article className="space-y-6">
      <PostStatusWatcher postId={post.id} initialStatus={post.status} />

      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <PostSourceBadge sourceType={post.source_type} />
            <PostStatusBadge status={post.status} />
            <span className="text-muted-foreground text-xs">#{post.id}</span>
          </div>
          <h1 className="text-2xl font-bold">{post.title}</h1>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {post.source_name ? <span>출처: {post.source_name}</span> : null}
            {post.source_published_at ? (
              <span>작성일: {dayjs(post.source_published_at).format('YYYY.MM.DD')}</span>
            ) : null}
            <span>게시일: {dayjs(post.created_at).format('YYYY.MM.DD')}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canDelete ? <PostDeleteButton postId={post.id} postTitle={post.title} /> : null}
          <Link href="/reports" className={buttonVariants({ variant: 'ghost' })}>
            ← 목록
          </Link>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-2 p-4 text-sm">
          <div className="text-muted-foreground font-medium">원본 자료</div>
          {post.source_url ? (
            <div>
              <a
                className="text-primary hover:underline"
                href={post.source_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {post.source_url}
              </a>
            </div>
          ) : null}
          {reportFileUrl ? (
            <div>
              <a
                className="text-primary hover:underline"
                href={reportFileUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                📄 {post.file_name ?? 'PDF 다운로드'}
              </a>
            </div>
          ) : null}
          {!post.source_url && !reportFileUrl ? (
            <div className="text-muted-foreground">원본 자료 정보가 없습니다.</div>
          ) : null}
        </CardContent>
      </Card>

      {post.status === 'processing' ? (
        <Alert>
          <AlertTitle>본문을 생성하는 중입니다…</AlertTitle>
          <AlertDescription>
            보통 30초 ~ 수 분이 소요됩니다. 페이지는 자동으로 새로 고쳐집니다.
          </AlertDescription>
        </Alert>
      ) : null}

      {post.status === 'failed' ? (
        <Alert variant="destructive">
          <AlertTitle>본문 생성에 실패했습니다.</AlertTitle>
          <AlertDescription>
            {post.error_message ?? '원인을 알 수 없습니다. 다시 시도해 주세요.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {post.content ? <MarkdownView content={post.content} /> : null}
    </article>
  );
}

export default function ReportDetailPage({ params }: PageProps) {
  return (
    <Suspense fallback={<div className="text-muted-foreground p-6 text-sm">보고서 로딩 중…</div>}>
      <ReportDetailBody params={params} />
    </Suspense>
  );
}
