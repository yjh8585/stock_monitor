import { Suspense } from 'react';

import { PostDetail } from '@/components/reports/post-detail';

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

async function Body({ params }: PageProps) {
  const { id } = await params;
  return <PostDetail id={id} backHref="/reports" />;
}

export default function ReportDetailPage({ params }: PageProps) {
  return (
    <Suspense fallback={<div className="text-muted-foreground p-6 text-sm">보고서 로딩 중…</div>}>
      <Body params={params} />
    </Suspense>
  );
}
