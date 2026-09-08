import Link from 'next/link';
import { redirect } from 'next/navigation';

import { NewPostForm } from '@/components/reports/new-post-form';
import { buttonVariants } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canPublishReports } from '@/lib/auth/permissions';

export const metadata = {
  title: '글쓰기 — 보고서',
};

export default async function NewReportPage() {
  // 게시 권한이 없으면 폼을 보여 주지 않는다 — API(Task 2)와 같은 게이트.
  const user = await getCurrentUser();
  if (!user || !canPublishReports(user.role)) {
    redirect('/reports');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold">새 게시글</h1>
          <p className="text-muted-foreground text-sm">
            소스 형태를 선택하면 LLM 이 본문을 자동으로 생성합니다.
          </p>
        </div>
        <Link href="/reports" className={buttonVariants({ variant: 'ghost' })}>
          ← 목록
        </Link>
      </div>

      <NewPostForm />
    </div>
  );
}
