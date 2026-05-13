import Link from 'next/link';

import { NewPostForm } from '@/components/reports/new-post-form';
import { buttonVariants } from '@/components/ui/button';

export const metadata = {
  title: '글쓰기 — 보고서',
};

export default function NewReportPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">새 게시글</h1>
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
